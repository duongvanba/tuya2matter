import { Injectable } from "@nestjs/common";
import { MatterService } from "./Matter.js";
import { TuyaDeviceService } from "./TuyaDeviceService.js";
import { filter, from, merge, mergeAll, mergeMap, of, switchMap, tap } from "rxjs";
import { Tuya2Matter } from "../libs/tuya2matter/Tuya2Matter.js";
import { VITURAL_SWITCHES } from "../const.js";
import { VituralSwitch } from "../libs/vitural/VituralSwitch.js";


@Injectable()
export class SyncService {


    constructor(
        devices$: TuyaDeviceService,
        matter: MatterService
    ) {
        matter.aggregator$.pipe(
            switchMap(aggregator => merge(
                of(VITURAL_SWITCHES).pipe(
                    tap(() => console.log(`[${new Date().toLocaleTimeString()}]     [VITURAL SWITCHES INITIALIZING] - ${VITURAL_SWITCHES.length} switches`)),
                    mergeAll(),
                    mergeMap(name => {
                        const id = Buffer.from(name).toString('hex').slice(0, 32)
                        return new VituralSwitch(aggregator, id, name).start()
                    })
                ),
                devices$.pipe(
                    mergeMap(async device => {
                        const linker = new Tuya2Matter(aggregator, device)
                        await linker.init()
                    })
                )
            )),

        ).subscribe()
    }
}