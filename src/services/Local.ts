import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { distinctUntilKeyChanged, exhaustMap, filter, first, firstValueFrom, from, groupBy, map, mergeAll, mergeMap, Observable, switchMap, tap } from "rxjs";
import { CloudSync } from "./CloudSync.js";
import { TuyaConnection } from "../libs/tuyapi/TuyaConnection.js";




@Injectable()
export class LocalService extends Observable<TuyaDevice> {

    #connections = new Map<string, TuyaConnection>
    #devices = new Set<string>

    constructor(
        private cloud: CloudSync
    ) {
        super(o => {
            const subscription = this.cloud.pipe(
                filter(Boolean),
                first(),
                switchMap(({ config }) => TuyaConnection.watch().pipe(
                    groupBy($ => $.gwId),
                    mergeMap($ => $.pipe(
                        mergeMap(async $ => {
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

                            console.log(`Found ${metadata.name} on ${$.ip}`)
                            const connection = new TuyaConnection(metadata, subs)
                            connection.connect($)
                            await firstValueFrom(connection.$status.pipe(
                                filter(s => s == 'online')
                            ))
                            this.#connections.set($.gwId, connection)
                            return [
                                ...metadata.is_gateway ? [] : [new TuyaDevice(connection, metadata)],
                                ...subs ? subs.map(m => new TuyaDevice(connection, m)) : []
                            ]
                        }, 1),
                    )),
                    mergeAll()
                )),

            ).subscribe(o)

            o.add(() => subscription.unsubscribe())
        })
    }




}