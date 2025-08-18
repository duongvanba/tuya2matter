import { Injectable } from "@nestjs/common";
import { Endpoint, ServerNode, VendorId, } from "@matter/main";
import { AggregatorEndpoint } from "@matter/main/endpoints/aggregator";




@Injectable()
export class MatterService {

    #aggregator: Endpoint<AggregatorEndpoint>



    get aggregator() {
        return this.#aggregator
    }


    private async onModuleInit() {
        const id = '1755148286885'
        const productId = 32768
        const productName = 'duongvanba@matter'
        const deviceName = 'Matter test device'
        const vendorName = 'matter-node.js'
        const passcode = 22091997
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
            }
        })
        const aggregator = new Endpoint(AggregatorEndpoint, {
            id: "aggregator"
        });
        await server.add(aggregator)
        this.#aggregator = aggregator
        await server.start()

    }
}