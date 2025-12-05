
import got from 'got';
import * as crypto from "crypto";
import { BehaviorSubject, firstValueFrom, from, interval, mergeMap, reduce, ReplaySubject, takeUntil, tap, toArray } from 'rxjs';
import { DeviceMetadata } from './DeviceMetadata.js';
import { Observable } from 'rxjs';
import { ReadableDps } from './TuyaLocal.js';
import { existsSync } from 'fs';
import { DIR, TUYA_CLIENT_ID, TUYA_SCHEMA } from '../../const.js';




export type Dict = Record<string, any>

export type TuyaHome = {
    name: string
    ownerId: string
    status: boolean
    uid: string
    id: number
}



export type TuyaCredential = {
    usercode: string
    access_token: string
    refresh_token: string,
    expire_time: 7200,
    terminal_id: string
    uid: string
    username: string
    endpoint: string
}

export type TuyaDeviceHomeMap = {
    homes: {
        [home_id: string]: TuyaHome
    },
    devices: {
        [device_id: string]: DeviceMetadata
    }
}

export class TuyaCloud {

    public readonly credential$ = new ReplaySubject<TuyaCredential>(1)
    public online$ = new BehaviorSubject(false)
    public readonly $stop = new ReplaySubject<void>(1)


    static async #getCredential(usercode: string) {
        const client = got.extend({
            prefixUrl: 'https://apigw.iotbing.com/v1.0/m/life/home-assistant',
            throwHttpErrors: false
        });


        const response = await client.post(`qrcode/tokens`, {
            searchParams: {
                clientid: TUYA_CLIENT_ID,
                usercode,
                schema: TUYA_SCHEMA
            }
        }).json<{ success: boolean, msg: string, result: { qrcode: string } }>()
        if (!response.success) {
            throw new Error(response.msg)
        }
        const token = response.result.qrcode
        const qrcode = 'tuyaSmart--qrLogin?token=' + token
        const next = async () => {
            for (let i = 1; i <= 30; i++) {
                await Bun.sleep(5000)
                const result = await client(`qrcode/tokens/${token}`, {
                    searchParams: {
                        clientid: TUYA_CLIENT_ID,
                        usercode
                    }
                }).json<{
                    success: boolean,
                    result: TuyaCredential
                }>()
                if (result.result) return {
                    ...result.result,
                    usercode
                }
            }
            return null
        }

        return { qrcode, next }
    }

    static async login(usercode: string) {
        const task = await this.#getCredential(usercode)

        const next = async () => {
            const credential = await task.next()
            await Bun.file(`${DIR}/credential.json`).write(JSON.stringify(credential, null, 2))
            return credential ? new this(credential) : null
        }

        return {
            qrcode: task.qrcode,
            next
        }
    }

    constructor(private config: TuyaCredential) {
        this.credential$.next(config)
        interval(100 * 60000).pipe(
            takeUntil(this.$stop),
            mergeMap(() => this.refresh())
        ).subscribe()
    }

    #aesGcmEncrypt(obj: any, secret: string): string {
        const rawData = obj ? JSON.stringify(obj) : ""
        const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
        const randomNonce = Array.from({ length: 12 }, () => chars[crypto.randomInt(chars.length)]).join("");
        const nonce = Buffer.from(randomNonce, "utf8"); // 12 bytes
        const key = Buffer.from(secret, "utf8"); // 16 bytes
        // @ts-ignore
        const cipher = crypto.createCipheriv("aes-128-gcm", key, nonce);
        // @ts-ignore
        const ciphertext = Buffer.concat([cipher.update(rawData, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag(); // 16 bytes
        // @ts-ignore
        const combined = Buffer.concat([ciphertext, tag]);
        // @ts-ignore
        return Buffer.from(nonce).toString("base64") + Buffer.from(combined).toString("base64")
    }

    #aexGcmDecrypt(cipherDataB64Concat: string, secret: string): string {
        const all = Buffer.from(cipherDataB64Concat, 'base64')
        const nonce = all.subarray(0, 12);
        const cipherAndTag = all.subarray(12);
        if (cipherAndTag.length < 16) {
            throw new Error("Invalid cipher data");
        }
        const key = Buffer.from(secret, "utf8");
        const tag = cipherAndTag.subarray(cipherAndTag.length - 16);
        const ct = cipherAndTag.subarray(0, cipherAndTag.length - 16);
        // @ts-ignore
        const decipher = crypto.createDecipheriv("aes-128-gcm", key, nonce);
        // @ts-ignore
        decipher.setAuthTag(tag);
        // @ts-ignore
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
        return plain.toString("utf8");
    }

    #restfulSign(
        hashKey: string,
        queryEncdata: string,
        bodyEncdata: string,
        headers: Record<string, string>
    ): string {
        const order = ["X-appKey", "X-requestId", "X-sid", "X-time", "X-token"];
        let headerSignStr = "";
        for (const h of order) {
            const v = headers[h];
            if (v && v !== "") headerSignStr += `${h}=${v}||`;
        }
        let signStr = headerSignStr.endsWith("||")
            ? headerSignStr.slice(0, -2)
            : headerSignStr;

        if (queryEncdata) signStr += queryEncdata;
        if (bodyEncdata) signStr += bodyEncdata;
        // @ts-ignore
        const hmac = crypto.createHmac("sha256", Buffer.from(hashKey, "utf8"));
        // @ts-ignore
        hmac.update(Buffer.from(signStr, "utf8"));
        return hmac.digest("hex");
    }


    async request<T>({ method = 'GET', path, body, params }: {
        method?: "GET" | "POST" | "PUT" | "DELETE",
        path: string,
        params?: Dict,
        body?: Dict
    }) {
        const credential = await firstValueFrom(this.credential$)
        const rid = crypto.randomUUID();
        const md5 = crypto.createHash("md5");
        // @ts-ignore
        md5.update(Buffer.from(rid + credential.refresh_token, "utf8"));
        const hash_key = md5.digest("hex");
        // @ts-ignore
        const hmac = crypto.createHmac("sha256", Buffer.from(rid, "utf8"));
        // @ts-ignore
        hmac.update(Buffer.from(hash_key, "utf8"));
        const secret = hmac.digest("hex").slice(0, 16)
        // encrypt params/body to encdata if present
        const searchParams$ = params && Object.keys(params).length ? this.#aesGcmEncrypt(params, secret) : ""
        const json$ = body && Object.keys(body).length ? this.#aesGcmEncrypt(body, secret) : ""
        const t = Date.now();
        const headers: Record<string, string> = {
            "X-appKey": TUYA_CLIENT_ID,
            "X-requestId": rid,
            "X-sid": "",
            "X-time": String(t),
            "X-token": credential.access_token
        };
        headers["X-sign"] = this.#restfulSign(hash_key, searchParams$, json$, headers);
        const url = credential.endpoint + path;
        const response = await got(url, {
            method,
            searchParams: searchParams$ ? { encdata: searchParams$ } : {},
            json: json$ ? { encdata: json$ } : undefined,
            headers,
            throwHttpErrors: false
        }).json<{ success: boolean, code: number, msg: string, result: any, data: T }>()
        if (!response.success) return response
        return {
            ...response,
            data: JSON.parse(this.#aexGcmDecrypt(response.result, secret)) as T
        }
    }


    #refreshing = false
    // ====== Token refresh ======s
    async refresh() {
        if (this.#refreshing) return true
        this.#refreshing = true;
        const credential = await firstValueFrom(this.credential$)
        await Bun.file(`${DIR}/credential.json`).write(JSON.stringify(credential, null, 2))
        try {
            const res = await this.request<{
                accessToken: string
                refreshToken: string
            }>({ path: `/v1.0/m/token/${credential.refresh_token}` });
            if (res.data) {
                this.credential$.next({
                    ...credential,
                    access_token: res.data.accessToken,
                    refresh_token: res.data.refreshToken
                })
                return true
            }
        } catch (e: any) {
            // giữ nguyên phong cách log ngắn gọn
            console.error("network error on refresh =", e?.message ?? e);
        }
        this.#refreshing = false;
        return false
    }


    async listHomes() {
        const path = `/v1.0/m/life/users/homes`
        const r = await this.request<TuyaHome[]>({ path })
        return r.data || []
    }

    async listDevices(homeId: string | number) {
        const path = `/v1.0/m/life/ha/home/devices`
        type BasicDeviceMetadata = Omit<DeviceMetadata, 'mapping' | 'home_id' | 'gateway_id' | 'supportLocal'>
        const r = await this.request<BasicDeviceMetadata[]>({
            path,
            params: { homeId }
        })
        return r.data || []
    }

    async getDeviceStatus(device_id: string) {
        const r = await this.request<{
            category: string
            dpStatusRelationDTOS: Array<{
                dpCode: string,
                dpId: number
            }>,
            supportLocal: boolean
        }>({ path: `/v1.0/m/life/devices/${device_id}/status` })
        return r.data
    }


    async fetchAll(cacheFirst: boolean) {
        const path = `${DIR}/devices.json`
        if (cacheFirst && existsSync(path)) {
            const cache = await Bun.file(path).json() as { [userCode: string]: TuyaDeviceHomeMap }
            const data = cache ? cache[this.config.usercode] : null
            if (data) return data
        }
        const homes = await this.listHomes()
        if (homes.length == 0) return { devices: {}, homes: {} } as TuyaDeviceHomeMap
        return await firstValueFrom(from(homes).pipe(
            mergeMap(async home => {
                const all_devices = await this.listDevices(home.ownerId)
                const a = Date.now()
                console.log({ found: home.name, devices: all_devices.length, status: 'checking' })
                const list = await firstValueFrom(from(all_devices).pipe(
                    mergeMap(async device => {
                        const r = await this.getDeviceStatus(device.id)
                        const mapping = r.dpStatusRelationDTOS.reduce((p, c) => {
                            const m = {
                                code: c.dpCode,
                                dp_id: Number(c.dpId)
                            }
                            return {
                                ...p,
                                [Number(c.dpId)]: m,
                                [c.dpCode]: m
                            }
                        }, {})
                        const merged: DeviceMetadata = {
                            ...device,
                            mapping,
                            home_id: home.ownerId
                        }
                        return merged
                    }, 3),
                    toArray()
                ), { defaultValue: [] as DeviceMetadata[] })
                console.log({
                    home: home.name,
                    devices: all_devices.length,
                    status: 'done',
                    time: Date.now() - a
                })
                const hubs = list.filter(
                    c => !c.sub && ['wfcon', 'wg2'].includes(c.category)
                ).reduce((p, c) => ({ ...p, [c.id]: c }), {} as { [id: string]: DeviceMetadata })

                const devices = list.map(d => {
                    const hub_ids = Object.keys(hubs)
                    const gateway_id = d.sub && hub_ids.length == 1 ? hub_ids[0]! : null
                    const is_gateway = !!hubs[d.id]
                    return {
                        ...d,
                        gateway_id,
                        is_gateway
                    } as DeviceMetadata
                }).reduce((p, c) => ({
                    ...p,
                    [c.id]: c
                }), {})
                return {
                    home,
                    devices,
                    hubs
                }
            }, 1),
            reduce((p, c) => {
                return {
                    homes: {
                        ...p.homes,
                        [c.home.id]: c.home
                    },
                    devices: {
                        ...p.devices,
                        ...c.devices
                    }
                }
            }, {} as TuyaDeviceHomeMap),
            tap(async devices => {
                const data = {
                    [this.config.usercode]: devices
                }
                await Bun.file(path).write(JSON.stringify(data, null, 2))
            })
        ))
    }

    [Symbol.dispose]() {
        this.$stop.next()
    }

    watch(_device_id: string) {
        return new Observable<ReadableDps>(_o => {

        })
    }

    async listSences(home_id: string) {
        const { data } = await this.request<Array<{
            scene_id: string
            name: string
            enabled: boolean
            background: string
            actions: Array<{
                action_executor: "dpIssue" | "delay"
                entity_id: string
                executor_property: Record<string, string>
            }>
        }>>({
            method: 'GET',
            path: `/v1.0/m/scene/ha/home/scenes`,
            params: { homeId: home_id }
        })
        return data
    }

    async triggerSence(home_id: string, scene_id: string) {
        return await this.request({
            method: 'POST',
            path: `/v1.0/m/scene/ha/trigger`,
            params: { homeId: home_id, sceneId: scene_id }
        })
    }

    async sendCommand(device_id: string, dps: ReadableDps) {
        await this.request({
            method: 'POST',
            path: `/v1.1/m/thing/${device_id}/commands`,
            body: dps
        })
    }


    static async initFromCache(userCode: string) {
        const path = `${DIR}/credential.json`
        if (existsSync(path)) {
            const credential = await Bun.file(path).json() as TuyaCredential
            if (credential && credential.usercode == userCode) {
                const client = new this(credential)
                if (await client.refresh()) {
                    return client
                }
            }
        }
    }



}
