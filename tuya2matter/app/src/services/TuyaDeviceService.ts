import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { exhaustMap, filter, firstValueFrom, groupBy, map, mergeAll, mergeMap, ReplaySubject, Subject, tap } from "rxjs";
import { TuyaLocal } from "../libs/tuyapi/TuyaLocal.js";
import { TuyaCloud, TuyaDeviceHomeMap } from "../libs/tuyapi/TuyaCloud.js";
import QrCode from 'qrcode-terminal'
import { USER_CODE } from "../const.js";



@Injectable()
export class TuyaDeviceService extends Subject<TuyaDevice> {

    #connections = new Map<string, TuyaLocal>
    #devices = new Set<string>
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
                map($ => ({ ...$, ...$.payload })),
                exhaustMap(async $ => {

                    const device_id = $.gwId
                    if (this.#connections.has(device_id)) {
                        const connection = this.#connections.get(device_id)!
                        connection.connect($)
                        return []
                    }
                    const metadata = homes.devices[device_id]
                    if (!metadata || this.#devices.has(metadata.id)) return []

                    this.#devices.add(metadata.id)
                    const subs = metadata.is_gateway ? (
                        Object.values(homes.devices).filter(d => d.sub && d.gateway_id == metadata.id && !this.#devices.has(d.id))
                    ) : null
                    subs && subs.forEach(d => this.#devices.add(d.id))

                    const connection = new TuyaLocal(metadata, subs)
                    connection.connect($)
                    await firstValueFrom(connection.$status.pipe(
                        filter(s => s == 'online')
                    ))
                    this.#connections.set(device_id, connection)
                 
                    const devices = [
                        ...metadata.is_gateway ? [] : [new TuyaDevice({ ...metadata, ip: $.ip })],
                        ...subs ? subs.map(m => new TuyaDevice({ ...m, ip: $.ip })) : []
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