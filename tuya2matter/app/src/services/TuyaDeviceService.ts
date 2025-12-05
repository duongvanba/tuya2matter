import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { exhaustMap, filter, firstValueFrom, groupBy, map, mergeAll, mergeMap, ReplaySubject, Subject, take, tap } from "rxjs";
import { TuyaLocal } from "../libs/tuyapi/TuyaLocal.js";
import { TuyaCloud, TuyaDeviceHomeMap } from "../libs/tuyapi/TuyaCloud.js";
import QrCode from 'qrcode-terminal'
import { USER_CODE } from "../const.js";



@Injectable()
export class TuyaDeviceService extends Subject<TuyaDevice> {

    #connections = new Map<string, TuyaLocal>
    public homes$ = new ReplaySubject(1)


    async onModuleInit() {
        const api = await this.#getCloudClient()
        const homes = await api.fetchAll(!!process.env.DEV)
        this.homes$.next(homes)
        this.start(homes)
    }

    async start(homes: TuyaDeviceHomeMap) {

        // console.log('Scanning')
        // await TuyaLocal.scan()
        // return

        TuyaLocal.watch().pipe(
            groupBy($ => $.payload.gwId),
            mergeMap($ => $.pipe(
                map(({ payload: { gwId, ip, version } }) => {
                    const metadata = homes.devices[gwId]
                    if (metadata) {
                        return {
                            metadata,
                            ip,
                            version,
                            device_id: metadata.id
                        }
                    }
                }),
                filter(Boolean),
                exhaustMap(async ({ device_id, ip, metadata, version }) => {

                    // Init connection or get from cache
                    const sub_device_ids = metadata.is_gateway ? Object.values(homes.devices).filter(d => d.sub && d.gateway_id == metadata.id) : null
                    const connection = this.#connections.get(device_id) || new TuyaLocal(metadata, sub_device_ids)
                    await connection.connect({ ip, version })

                    // Setup for new device only
                    if (this.#connections.has(device_id)) return []
                    this.#connections.set(device_id, connection)
                    const devices = [
                        ...metadata.is_gateway ? [] : [new TuyaDevice({ ...metadata, ip })],
                        ...sub_device_ids ? sub_device_ids.map(m => new TuyaDevice({ ...m, ip })) : []
                    ]
                    devices.forEach(d => d.linkLocal(connection))
                    return devices
                }),
            )),
            mergeAll()

        ).subscribe(this)
    }

    async #getCloudClient() {
        const cache = await TuyaCloud.initFromCache(USER_CODE)
        if (cache) return cache
        const { next, qrcode } = await TuyaCloud.login(USER_CODE)
        console.log(`Use Tuya app to scan this bellow qr code:\n\n`)
        console.log(`QRcode URL: https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(qrcode)}`)
        QrCode.generate(qrcode, { small: true })
        const hass = await next()
        if (!hass) {
            console.error({ error: 'CAN_NOT_LOGIN' })
            await Bun.sleep(5000)
            process.exit(1)
        }
        return hass
    }




}