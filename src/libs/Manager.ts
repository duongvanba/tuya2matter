import { lastValueFrom, mergeMap, from, map, filter, tap } from "rxjs"
import { throttMerge } from "../helpers/throttMerge.js"
import { TuyaSupportDevices } from "./tuya2mqtt/TuyaSupportDevices.js"
import { TuyaCloud } from "./tuyapi/TuyaCloud.js"
import { TuyaConnection } from "./tuyapi/TuyaConnection.js"
import { TuyaDevice } from "./tuyapi/TuyaDevice.js"
import { LightweightMqtt } from "./tuya2mqtt/LightweightMqtt.js"
import { Tuya2MqttDevice } from "./tuya2mqtt/Tuya2MqttDevice.js"



export class Manager {

    #connections = new Map<string, TuyaConnection>()
    #devices = new Map<string, Tuya2MqttDevice>()

    constructor(private mqtt: LightweightMqtt) {
        this.#init()
        this.#sync()
    }

    #init() {
        const cloud = new TuyaCloud(
            process.env.API_KEY!,
            process.env.API_SECRET!
        )

        lastValueFrom(from(cloud.load_devices(process.env.USER_ID!)).pipe(
            mergeMap(configs => (
                TuyaConnection.watch_local_devices_broadcasts().pipe(
                    map(m => ({ ...m, $: configs[m.gwId] })),
                    filter(m => !!m.$)
                )
            )),
            throttMerge(async ({ $, gwId, ip, version }) => {
                const { gateway, sub_devices } = $
                const is_new_gateway = !this.#connections.has(gwId)
                const cids = sub_devices.map(s => s.node_id!)
                const connection = this.#connections.get(gwId) || new TuyaConnection(gateway, cids)
                if (is_new_gateway) {
                    this.#connections.set(gwId, connection)
                    const devs = cids.length == 0 ? [gateway] : sub_devices
                    lastValueFrom(from(devs).pipe(
                        mergeMap(async config => {
                            config.name = config.name.charAt(0).toUpperCase() + config.name.slice(1)
                            const device = new TuyaDevice(connection, config)
                            const factory = TuyaSupportDevices[config.category] as typeof TuyaSupportDevices[keyof typeof TuyaSupportDevices]
                            if (!factory) return
                            const t2mdev = new factory(this.mqtt, device)
                            await t2mdev.init()
                            await t2mdev.configure()
                            this.#devices.set(device.device_id, t2mdev)
                        })
                    ), { defaultValue: [] })
                }
                connection.connect({ ip, version })
            })
        ), { defaultValue: [] })

    }

    #sync(){
        lastValueFrom(this.mqtt.listen('homeassistant/status').pipe(
            tap(status => console.log(`Home assistant ${status}`)),
            filter(status => status == 'online'),
            throttMerge(async () => {
                console.log('Syncing devices ...')
                await lastValueFrom(from(this.#devices.values()).pipe(
                    mergeMap(async (dev, index) => {
                        console.log(`${index++}/${this.#devices.size}: ${dev.tuya_device.config.name}`)
                        await dev.configure()
                        await dev.tuya_device.sync()
                    })
                )) 
                console.log(`All deivice synced`) 
            })
        ))
    }
 
}