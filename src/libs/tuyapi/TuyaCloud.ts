import { TuyaContext } from "@tuya/tuya-connector-nodejs"
import { existsSync, readFileSync, writeFileSync } from "fs"
import { lastValueFrom, from, filter, bufferCount, mergeMap, mergeAll, reduce } from "rxjs"
import { TuyaDeviceConfig } from "./TuyaConnection.js"


export const CONFIG_PATH = process.env.CONFIG_PATH || './config'

export type DeviceConfigList = {
    [gateway_id: string]: {
        gateway: TuyaDeviceConfig,
        sub_devices: TuyaDeviceConfig[]
    }
}

export class TuyaCloud {

    constructor(
        private API_KEY: string,
        private API_SECRET: string,
        private REGION: string = 'us'
    ) {

    }

    load_local_devices(user_id: string) {
        if (!existsSync(`${CONFIG_PATH}/${user_id}.json`)) return
        return JSON.parse(readFileSync(`${CONFIG_PATH}/${user_id}.json`, 'utf8')) as DeviceConfigList
    }

    async pull_devices_from_cloud(user_id: string) {

        // Inital cloud instance
        console.log(`Pulling devices from cloud ...`)
        const api = new TuyaContext({
            baseUrl: `https://openapi.tuya${this.REGION}.com`,
            accessKey: this.API_KEY,
            secretKey: this.API_SECRET
        })

        // Get devices list
        type DevConfig = Omit<TuyaDeviceConfig, 'mapping' | 'device_id'> & { id: string }
        const devices_query = await api.request<DevConfig[]>({
            method: 'GET',
            path: `/v1.0/users/${user_id}/devices`
        })
        if (!devices_query.result) throw new Error('Problem with API credential')
        if (devices_query.result.length == 0) throw new Error('No device found on tuya cloud')

        console.log(`Total ${devices_query.result.length} devices`)
        console.log(`Getting mac addresses ...`)

        // Pull mac addresses
        const mac_addresses_map = await lastValueFrom(from(devices_query.result).pipe(
            filter(device => !device.sub),
            bufferCount(30),
            mergeMap(async devices => {
                const ids = devices.map(d => d.id).join(',')
                const rs = await api.request<Array<{ id: string, mac: string }>>({
                    method: 'GET',
                    path: `/v1.0/devices/factory-infos?device_ids=${ids}`
                })
                return rs.result || []
            }, 1),
            mergeAll(),
            reduce((p, c) => {
                p.set(c.id, c.mac)
                return p
            }, new Map<string, string>())
        ))

        // Get data points mapping
        console.log(`Getting mapping ...`)
        const dps_map = await lastValueFrom(from(devices_query.result).pipe(
            mergeMap(async dev => {
                const r = await api.request<{
                    properties: Array<{
                        code: string
                        dp_id: string
                        value: string | boolean | number
                    }>
                }>({
                    method: 'GET',
                    path: `/v2.0/cloud/thing/${dev.id}/shadow/properties`
                })
                return {
                    device_id: dev.id,
                    mapping: r?.result?.properties?.reduce(
                        (p, c) => ({
                            ...p,
                            [c.dp_id]: c,
                            [c.code]: c
                        }), {}
                    ) || {}
                }
            }, 10),
            reduce((p, c) => {
                p.set(c.device_id, c.mapping)
                return p
            }, new Map<string, TuyaDeviceConfig['mapping']>())
        ))

        const mapped_devices = devices_query.result.map(c => ({
            ...c,
            device_id: c.id,
            mapping: dps_map.get(c.id) || {},
            mac: mac_addresses_map.get(c.id) || c.mac
        } as TuyaDeviceConfig))

        const devices = mapped_devices.filter(c => !c.sub).reduce((p, gateway) => {
            return {
                ...p,
                [gateway.device_id]: {
                    gateway,
                    sub_devices: mapped_devices.filter(d => d.device_id != gateway.device_id && d.local_key == gateway.local_key)
                }
            }
        }, {} as DeviceConfigList)


        writeFileSync(`${CONFIG_PATH}/${user_id}.json`, JSON.stringify(devices, null, 2))
        console.log('Done')
        return devices
    }

    async load_devices(user_id: string) {
        return this.load_local_devices(user_id) || await this.pull_devices_from_cloud(user_id)
    }
}