
import got from 'got';
import * as crypto from "crypto";
import { sleep } from '../../helpers/sleep.js';
import { firstValueFrom, from, map, mergeAll, mergeMap, reduce, scan, toArray } from 'rxjs';
import { DeviceMetadata } from './DeviceMetadata.js';


const TUYA_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
const TUYA_SCHEMA = 'haauthorize';

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
    [x: string]: {
        home: TuyaHome
        hubs: {
            [id: string]: DeviceMetadata
        };
        wifi: {
            [id: string]: DeviceMetadata
        };
        children: {
            [id: string]: DeviceMetadata
        }
    };
}

export class TuyaHass {

    static async getCredential(usercode: string) {
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
                await sleep(5000)
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
        const task = await this.getCredential(usercode)
        const next = async () => {
            const credential = await task.next()
            return credential ? new this(credential) : null
        }

        return {
            qrcode: task.qrcode,
            next
        }
    }


    constructor(public readonly config: TuyaCredential) {

    }

    #aesGcmEncrypt(obj: any, secret: string): string {
        const rawData = obj ? JSON.stringify(obj) : ""
        const chars = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";
        const randomNonce = Array.from({ length: 12 }, () => chars[crypto.randomInt(chars.length)]).join("");
        const nonce = Buffer.from(randomNonce, "utf8"); // 12 bytes
        const key = Buffer.from(secret, "utf8"); // 16 bytes
        const cipher = crypto.createCipheriv("aes-128-gcm", key, nonce);
        const ciphertext = Buffer.concat([cipher.update(rawData, "utf8"), cipher.final()]);
        const tag = cipher.getAuthTag(); // 16 bytes
        const combined = Buffer.concat([ciphertext, tag]);
        return Buffer.from(nonce).toString("base64") + Buffer.from(combined).toString("base64")
    }

    /**
     * AES-GCM decrypt:
     * - input là một chuỗi base64 ghép: base64(nonce) + base64(ciphertext||tag)
     * - Python phía nhận trả về: base64(nonce||ciphertext||tag), nhưng do concat 2 base64
     *   vẫn decode block-wise được thành nonce||cipher.
     * - Ở đây ta decode toàn chuỗi một lần -> ra nonce(12) + cipherAndTag
     */
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
        const decipher = crypto.createDecipheriv("aes-128-gcm", key, nonce);
        decipher.setAuthTag(tag);
        const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
        return plain.toString("utf8");
    }

    /**
     * Ký restful:
     * - headerSign: "X-appKey=a||X-requestId=b||X-sid=c||X-time=d||X-token=e"
     *   (chỉ thêm nếu có giá trị), chuỗi cuối bỏ "||"
     * - append query_encdata và body_encdata nếu có
     * - HMAC-SHA256(key=hash_key, msg=sign_str).hex()
     */
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

        const hmac = crypto.createHmac("sha256", Buffer.from(hashKey, "utf8"));
        hmac.update(Buffer.from(signStr, "utf8"));
        return hmac.digest("hex");
    }


    async request<T>({ method = 'GET', path, body, params }: {
        method?: "GET" | "POST" | "PUT" | "DELETE",
        path: string,
        params?: Dict,
        body?: Dict
    }) {
        const rid = crypto.randomUUID();
        const md5 = crypto.createHash("md5");
        md5.update(Buffer.from(rid + this.config.refresh_token, "utf8"));
        const hash_key = md5.digest("hex");
        const hmac = crypto.createHmac("sha256", Buffer.from(rid, "utf8"));
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
            "X-token": this.config.access_token
        };
        headers["X-sign"] = this.#restfulSign(hash_key, searchParams$, json$, headers);
        const url = this.config.endpoint + path;
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

        const now = Date.now();
        const expiredTime = this.config.expire_time;
        if (expiredTime - 60_000 > now) return true; // còn >1 phút thì thôi

        this.#refreshing = true;
        try {
            const res = await this.request<{
                accessToken: string
                refreshToken: string
            }>({ path: `/v1.0/m/token/${this.config.refresh_token}` });
            if (res.data) {
                this.config.access_token = res.data.accessToken
                this.config.refresh_token = res.data.refreshToken
                return true
            }

        } catch (e: any) {
            // giữ nguyên phong cách log ngắn gọn
            console.error("network error on refresh =", e?.message ?? e);
        } finally {
            this.#refreshing = false;
        }

        return false
    }

    async listHomes() {
        const path = `/v1.0/m/life/users/homes`
        const r = await this.request<TuyaHome[]>({ path })
        return r.data || []
    }

    async listDevices(homeId: string | number) {
        const path = `/v1.0/m/life/ha/home/devices`
        type R = Array<Omit<DeviceMetadata, 'mapping' | 'home_id' | 'gateway_id' | 'supportLocal'>>
        const r = await this.request<R>({
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


    fetchAll() {
        return firstValueFrom(from(this.listHomes()).pipe(
            mergeAll(),
            mergeMap(async home => {
                const devices = await this.listDevices(home.ownerId)
                console.log({ home: home.name, devices: devices.length })
                const a = Date.now()
                const config = await firstValueFrom(from(devices).pipe(
                    mergeMap(async device => {
                        const status = await this.getDeviceStatus(device.id)
                        const mapping = status.dpStatusRelationDTOS.reduce((p, c) => {
                            return {
                                ...p,
                                [Number(c.dpId)]: c.dpCode,
                                [c.dpCode]: Number(c.dpId)
                            }
                        }, {})
                        const merged: DeviceMetadata & { home: TuyaHome } = {
                            ...device,
                            mapping,
                            home,
                            home_id: home.ownerId,
                            supportLocal: status.supportLocal
                        }
                        return merged
                    }, 1),
                    toArray()
                ))
                console.log(`Loaded ${config.length} devices in ${Date.now() - a} ms`)
                return config
            }, 1),
            mergeAll(),
            reduce((p, { home, ...c }) => {
                const sub = c.sub
                const gateway = c.product_name.toLowerCase().includes('gateway')
                return {
                    ...p,
                    [c.home_id]: {
                        home,
                        children: {
                            ...p[c.home_id]?.children || {},
                            ...sub ? {
                                [c.id]: c
                            } : {}
                        },
                        hubs: {
                            ...p[c.home_id]?.hubs || {},
                            ...gateway ? {
                                [c.id]: c
                            } : {}
                        },
                        wifi: {
                            ...p[c.home_id]?.wifi || {},
                            ...c.sub ? {} : {
                                [c.id]: c
                            }
                        }
                    }
                }
            }, {} as TuyaDeviceHomeMap),
            map(devices => Object.entries(devices)),
            mergeAll(),
            map(([home_id, { children: _, home, hubs, wifi }]) => {
                const hub_ids = Object.keys(hubs)
                const gateway_id = hub_ids.length == 1 ? hub_ids[0]! : null
                const children = Object.entries(_).reduce((p, [id, device]) => {
                    return {
                        ...p,
                        [id]: {
                            ...device,
                            gateway_id
                        } as DeviceMetadata
                    }
                }, {})
                return {
                    [home_id]: {
                        home,
                        hubs,
                        wifi,
                        children
                    }
                }
            }),
            reduce(
                (p, c) => ({ ...p, ...c }) as TuyaDeviceHomeMap,
                {} as TuyaDeviceHomeMap
            )
        ))
    }


}
