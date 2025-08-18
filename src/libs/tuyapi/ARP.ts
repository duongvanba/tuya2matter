import { exec } from 'child_process';
import { Observable, firstValueFrom, interval, map, merge, mergeMap, of, timer } from 'rxjs';
import axios from 'axios'
import {createHash} from 'crypto'

export class ARP {
    static manual_configure(ipAddress: string, macAddress: string, timeoutMs: number) {

        const command = `sudo arp -s ${ipAddress} ${macAddress}`

        return firstValueFrom(merge(
            timer(timeoutMs).pipe(
                map(() => ({
                    success: false,
                    reason: 'RPC_UPDATE_TIMEOUT'
                }))
            ),
            new Observable<{ success: boolean, reason?: string }>(o => {
                const childProcess = exec(
                    command,
                    {},
                    (error, stdout, stderr) => {
                        if (error || stderr) {
                            const reason = error ? error.message : stderr
                            o.next({ success: false, reason })
                        } else {
                            o.next({ success: true })
                        }
                    }
                )

                return () => childProcess.kill()
            })
        ))
    }


}

let ip = ''
interval(60000).pipe(
    mergeMap(async () => {
        try {
            const mac = `78:E3:6D:83:87:1C`
            const time =  ((new Date).getTime() / 1e3).toFixed(0)
            const password = 'Duongvanba1997@'
            const data = await axios.post(`http://192.168.1.1/login`, {
                "method": "login",
                "params": {
                    "pw": createHash('md5').update(`${password}admin${time}`).digest('hex'),
                    "un": "admin",
                    time
                }
            })
            const sessionid = data.headers['set-cookie']?.[0]?.split(';')?.[0]

            const maki = await axios.get(`http://192.168.1.1/api/v1/lua/wifi/sta_list?page=1&size=20&mac=${mac}`, {
                headers: {
                    Cookie: sessionid
                }
            })
            const r = maki.data as { data: { list: Array<{ userIp: string }> } }
            const userIp = r.data?.list?.[0]?.userIp
            if (!userIp) {
                console.log(`Can not get Ip of maki home`)
            } else {
                if (userIp != ip) {
                    console.log(`Maki home IP is ${userIp}`)
                    ip = userIp
                    const { success, reason } = await ARP.manual_configure(userIp, mac, 5000)
                    console.log(success ? 'Maki IP updated' : 'Maki IP fail to update')
                }

            }
        } catch (e) {
            console.log((e as Error).message)
        }
    })
).subscribe()