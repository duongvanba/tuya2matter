import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { debounce, debounceTime, delay, EMPTY, exhaustMap, filter, firstValueFrom, from, groupBy, interval, lastValueFrom, map, merge, mergeAll, mergeMap, of, ReplaySubject, share, startWith, Subject, switchMap, take, tap, timer, withLatestFrom } from "rxjs";
import { TuyaLocal } from "../libs/tuyapi/TuyaLocal.js";
import { TuyaCloud, TuyaDeviceHomeMap } from "../libs/tuyapi/TuyaCloud.js";
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
        const cloudDevices$ = this.#getCloudClient().pipe(share())
        const last_udp_broadcasts = new Map<string, number>()

        return lastValueFrom(merge(
            TuyaLocal.watch(),
            interval(60 * 60000).pipe(
                startWith(0),
                switchMap(() => cloudDevices$),
                delay(10000),
                exhaustMap(homes => TuyaLocal.scan(this.#connections, homes.devices)),
                filter(({ gwId }) => {
                    const last_broadcast = last_udp_broadcasts.get(gwId) || 0
                    return (Date.now() - last_broadcast) > 60000
                })
            )
        ).pipe(
            withLatestFrom(cloudDevices$),
            map(([payload, homes]) => ({ payload, homes })),
            groupBy($ => $.payload.gwId),
            mergeMap($ => $.pipe(
                map(({ payload: { gwId, ip, version }, homes }) => {
                    last_udp_broadcasts.set(gwId, Date.now())
                    const metadata = homes.devices[gwId]
                    if (metadata) {
                        const sub_device_ids = metadata.is_gateway ? Object.values(homes.devices).filter(d => d.sub && d.gateway_id == metadata.id) : null
                        return {
                            metadata,
                            ip,
                            version,
                            device_id: metadata.id,
                            sub_device_ids
                        }
                    }
                }),
                filter(Boolean),
                exhaustMap(async ({ device_id, ip, metadata, version, sub_device_ids }) => {
                    // Init connection or get from cache
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
                })
            )),
            mergeAll(),
            tap(device => this.next(device))
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