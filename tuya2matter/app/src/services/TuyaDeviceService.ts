import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { delay, exhaustMap, filter, from, groupBy, interval, lastValueFrom, map, merge, mergeAll, mergeMap, of, ReplaySubject, share, startWith, Subject, switchMap, tap, withLatestFrom } from "rxjs";
import { TuyaLocal } from "../libs/tuyapi/TuyaLocal.js";
import { TuyaCloud } from "../libs/tuyapi/TuyaCloud.js";
import QrCode from 'qrcode-terminal'
import { USER_CODE } from "../const.js";



@Injectable()
export class TuyaDeviceService extends Subject<TuyaDevice> {

    #connections = new Map<string, TuyaLocal>
    public homes$ = new ReplaySubject(1)


    async onModuleInit() {
        this.start()
    }

    start() {

        return lastValueFrom(this.#getCloudClient().pipe(
            switchMap(homes => merge(
                TuyaLocal.watch(homes.devices),
                interval(5 * 60000).pipe(
                    startWith(0),
                    delay(60000),
                    exhaustMap(() => TuyaLocal.scan(this.#connections, homes.devices))
                )
            ).pipe(
                mergeMap(connection => {
                    const list = connection.config.is_gateway ? Object.values(homes.devices).filter(d => d.sub && d.gateway_id == connection.config.id) : [connection.config]
                    return list.map(m => {
                        const device = new TuyaDevice(m)
                        device.linkLocal(connection)
                        this.next(device)
                    })
                })
            ))
        )) 
    }


    #getCloudClient() {

        return from(TuyaCloud.initFromCache(USER_CODE)).pipe(
            mergeMap(cache => {
                if (cache) return of(cache)
                return from(TuyaCloud.login(USER_CODE)).pipe(
                    mergeMap(async ({ next, qrcode }) => {
                        console.log(`Use Tuya app to scan this bellow qr code:\n\n`)
                        console.log(`QRcode URL: https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(qrcode)}`)
                        QrCode.generate(qrcode, { small: true })
                        const hass = await next()
                        if (hass) return hass
                        console.error({ error: 'CAN_NOT_LOGIN' })
                        await Bun.sleep(5000)
                        process.exit(1)
                    })
                )
            }),
            filter(Boolean),
            mergeMap(cache => cache.fetchAll())
        )
    }




}