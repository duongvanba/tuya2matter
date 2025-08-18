import { Injectable } from "@nestjs/common";
import { MatterService } from "./Matter.js";
import { CloudSync } from "./CloudSync.js";





@Injectable()
export class SyncService {


    constructor(
        private cloud: CloudSync,
        private matter: MatterService
    ) { }

    private async onModuleInit() {
    }
}