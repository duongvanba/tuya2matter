import { Injectable } from "@nestjs/common";
import { Endpoint, ServerNode, VendorId, Environment, StorageService, Logger } from "@matter/main";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import QR from 'qrcode-terminal'
import { existsSync } from "fs";
import { ReplaySubject } from "rxjs";
const storageService = Environment.default.get(StorageService)


storageService.location = existsSync('/data') ? '/data/matter' : './.matter'
Logger.level = 'warn'

@Injectable()
export class MatterService {

    aggregator$ = new ReplaySubject<Endpoint<AggregatorEndpoint>>(1)



    async onModuleInit() {
        const id = '1755148286885'
        const productId = 32768
        const productName = 'tuya-matter-bridge'
        const deviceName = 'Tuya Matter Bridge'
        const vendorName = 'tuya-matter-bridge'
        const passcode = 20202021
        const discriminator = 3840
        const vendorId = 65521
        const port = 12356
        const serialNumber = `matterjs-${id}`

        const server = await ServerNode.create({
            id,
            network: { port },
            commissioning: {
                passcode,
                discriminator,
            },
            productDescription: {
                name: deviceName,
                deviceType: AggregatorEndpoint.deviceType,
            },
            basicInformation: {
                vendorName,
                vendorId: VendorId(vendorId),
                nodeLabel: productName,
                productName,
                productLabel: productName,
                productId,
                serialNumber,
                uniqueId: id,
            },

        })
        const aggregator = new Endpoint(AggregatorEndpoint, {
            id: "aggregator"
        });
        await server.add(aggregator)
        this.aggregator$.next(aggregator)
        await server.start()
        if (!server.state.commissioning.commissioned) {
            const { qrPairingCode } = server.state.commissioning.pairingCodes;
            console.log(`\nMatter QRCODE: \n`)
            QR.generate(qrPairingCode)
            console.log('\n\n')
        }


    }
}