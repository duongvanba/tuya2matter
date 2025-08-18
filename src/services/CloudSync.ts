import { Injectable } from "@nestjs/common";
import { TuyaCredential, TuyaDeviceHomeMap, TuyaHass } from "../libs/tuyapi/TuyaHass.js";
import { existsSync, readFileSync } from "fs";
import { generate } from 'qrcode-terminal'
import { sleep } from "../helpers/sleep.js";


@Injectable()
export class CloudSync {

    #hass: TuyaHass
    #config: TuyaDeviceHomeMap

    get api() {
        return this.#hass
    }

    get config() {
        return this.#config
    }


    private async onModuleInit() {
        const path = './credential.json'
        if (existsSync(path)) {
            const config = JSON.parse(readFileSync(path, 'utf-8')) as TuyaCredential
            this.#hass = new TuyaHass(config)
            return
        }
        const userCode = process.env.USER_CODE
        if (!userCode) {
            console.error(`Missing USER_CODE env !!!`)
            await sleep(5000)
            process.exit(1)
        }
        const { next, qrcode } = await TuyaHass.login(process.env.USER_CODE!)
        console.log(`Scan qr code bellow: `)
        generate(qrcode, { small: true })
        const hass = await next()
        if (!hass) {
            console.error(`Can not login !!!`)
            await sleep(5000)
            process.exit(1)
        }
        this.#hass = hass
        this.#config = await hass.fetchAll()
    }
}