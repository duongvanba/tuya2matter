import { Injectable } from "@nestjs/common";
import { Endpoint, ServerNode, VendorId, Environment, StorageService, Logger } from "@matter/main";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";
import QR from 'qrcode-terminal'
const storageService = Environment.default.get(StorageService)
storageService.location = './.matter'

Logger.level = 'warn'

@Injectable()
export class MatterService {

    #aggregator: Endpoint<AggregatorEndpoint>



    get aggregator() {
        return this.#aggregator
    }


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
        this.#aggregator = aggregator
        await server.start()
        const { qrPairingCode  } = server.state.commissioning.pairingCodes;
        console.log(`\nMatter QRCODE: \n`)
        QR.generate(qrPairingCode)
        console.log('\n\n')

    }
}