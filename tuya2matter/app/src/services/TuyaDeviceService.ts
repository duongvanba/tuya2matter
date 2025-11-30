import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { exhaustMap, filter, first, firstValueFrom, groupBy, map, mergeAll, mergeMap, Observable, Subject, switchMap, tap } from "rxjs";
import { CloudConfig } from "./CloudConfig.js";
import { TuyaLocal } from "../libs/tuyapi/TuyaLocal.js";




@Injectable()
export class TuyaDeviceService extends Subject<TuyaDevice> {

    #connections = new Map<string, TuyaLocal>
    #devices = new Set<string>

    constructor(
        private cloud: CloudConfig
    ) {
        super()
        this.cloud.pipe(
            filter(Boolean),
            first(),
            switchMap(({ config }) => TuyaLocal.watch().pipe(
                // filter(a => a.payload.gwId == 'eb693f2729ec0a6c57y38w'),
                groupBy($ => $.payload.gwId),
                mergeMap($ => $.pipe(
                    map($ => ({ ...$, ...$.payload })), 
                    exhaustMap(async $ => {
                        if (this.#connections.has($.gwId)) {
                            const connection = this.#connections.get($.gwId)!
                            connection.connect($)
                            return []
                        }
                        const metadata = config.devices[$.gwId]
                        if (!metadata || this.#devices.has(metadata.id)) return []

                        this.#devices.add(metadata.id)
                        const subs = metadata.is_gateway ? (
                            Object.values(config.devices).filter(d => d.sub && d.gateway_id == metadata.id && !this.#devices.has(d.id))
                        ) : null
                        subs && subs.forEach(d => this.#devices.add(d.id))

                        console.log(`[${metadata.id}] Found ${metadata.name} on ${$.ip} (v${$.version})`)
                        const connection = new TuyaLocal(metadata, subs)
                        connection.connect($)
                        await firstValueFrom(connection.$status.pipe(
                            filter(s => s == 'online')
                        ))
                        this.#connections.set($.gwId, connection)
                        const devices = [
                            ...metadata.is_gateway ? [] : [new TuyaDevice({ ...metadata, ip: $.ip })],
                            ...subs ? subs.map(m => new TuyaDevice({ ...m, ip: $.ip })) : []
                        ]
                        devices.forEach(d => d.linkLocal(connection))
                        return devices
                    }),
                )),
                mergeAll()
            )),
            tap(device => this.next(device))
        ).subscribe()
    }




}