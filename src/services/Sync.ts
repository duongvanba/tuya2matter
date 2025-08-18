import { Injectable } from "@nestjs/common";
import { MatterService } from "./Matter.js";
import { CloudSync } from "./CloudSync.js";
import { LocalService } from "./Local.js";
import { map } from "rxjs";





@Injectable()
export class SyncService {


    constructor(
        private local: LocalService,
        private matter: MatterService
    ) { }

    private async onModuleInit() {
        this.local.devices$.pipe(
            map(device => {
                // Map tp matter here
            })
        ).subscribe()
    }
}