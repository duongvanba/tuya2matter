import { Injectable } from "@nestjs/common";
import { MatterService } from "./Matter.js";
import { CloudSync } from "./CloudSync.js";
import { LocalService } from "./Local.js";
import { map, mergeMap } from "rxjs";
import { OnOffLightDevice } from "@matter/main/devices";
import { Endpoint } from "@matter/main";
import { Tuya2Matter } from "../libs/tuya2matter/Tuya2Matter.js";





@Injectable()
export class SyncService {


    constructor(
        devices$: LocalService,
        matter: MatterService
    ) {
        devices$.pipe(
            mergeMap(async device => {
                const linker = new Tuya2Matter(matter.aggregator, device)
                await linker.init()
                console.log(`Device ${device.config.name} ready`)
            })
        ).subscribe()
    }
}