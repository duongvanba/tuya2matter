import { createConnection } from "net";
import { Observable, merge, map, fromEvent, firstValueFrom, EMPTY, filter, tap, debounceTime, from } from "rxjs";
import ping from 'ping'
import { ARP } from './ARP.js'
import { sleep } from "../../helpers/sleep.js";

export class TuyaSocket {


    static async init(name: string, ip: string, port: number, mac: string) {

        const $ping = new Observable<boolean>(o => {
            let running = true
            setTimeout(async () => {
                while (running) {
                    const { alive } = await ping.promise.probe(ip, { timeout: 5, deadline: 5 })
                    o.next(alive)
                    await sleep(1000)
                }
            })

            return () => { running = false }
        })

        const pingable = await firstValueFrom($ping)

        if (!pingable) {
            const { reason, success } = await ARP.manual_configure(ip, mac, 3000)
            if (!success) {
                console.log(`[${new Date().toLocaleString()}]    Can not set ARP for ${name} due ${reason}`)
                return { socket: null, $error: EMPTY, end: () => { } }
            }
        }

        const socket = createConnection({
            host: ip,
            port: port,
            keepAlive: true,
            keepAliveInitialDelay: 5
        })

        const end = () => {
            socket.end()
            socket.destroy()
            socket.removeAllListeners()
        }

        const $error = firstValueFrom(merge(
            $ping.pipe(filter(pingable => !pingable), map(() => 'PING-FAIL')),
            fromEvent(socket, 'error').pipe(map((e: any) => (e.message || e.code || 'UNKNOWN_ERROR') as string)),
            fromEvent(socket, 'timeout').pipe(map(_ => 'TIMEOUT')),
            fromEvent(socket, 'end').pipe(map(_ => 'ENDED')),
            fromEvent(socket, 'close').pipe(map(_ => 'CLOSED')),
            fromEvent(socket, 'data').pipe(debounceTime(10000), map(() => 'TIMEOUT-10s'))
        ).pipe(
            tap(end) 
        ))



        const connected = await firstValueFrom(merge(
            from($error).pipe(map(() => false)),
            fromEvent(socket, 'connect').pipe(map(() => true))
        ))


        return { socket: connected ? socket : null, $error, end }

    }
}