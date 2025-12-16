import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise, MutableEndpoint, SupportedBehaviors } from "@matter/main";
import { GenericSwitchDevice, GenericSwitchRequirements, OnOffPlugInUnitRequirements, OnOffPlugInUnitDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, ElectricalEnergyMeasurementServer, ElectricalPowerMeasurementBehavior, ElectricalPowerMeasurementServer } from "@matter/main/behaviors";
import { map, tap } from "rxjs";



const SWITCH_CODES = ['switch_1', 'switch_2', 'switch_3', 'switch_4']

export class Tuya2MatterSwitch {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const switches = Object.entries(this.tuya.config.mapping).filter(
            ([k, v]) => SWITCH_CODES.includes(k)
        )
      const name = this.tuya.name.slice(0,32)
        const tuya = this.tuya

        const parts = switches.map(([name, { code }], index) => {
            const type = OnOffPlugInUnitDevice.withBehaviors(
                class extends OnOffPlugInUnitRequirements.OnOffServer {
                    override initialize(): MaybePromise { }
                    override on() {
                        tuya.setDps({ [code]: true })
                    }
                    override off() {
                        tuya.setDps({ [code]: false })
                    }
                }
            )
            return {
                id: code,
                type,
                onOff: { onOff: false },
                name: code,

            }
        })

        const bridgedDeviceBasicInformation = {
            nodeLabel: name,
            productName: name,
            productLabel: name,
            serialNumber: this.tuya.config.uuid,
            reachable: false
        }

        if (tuya.mapping.cur_current) {
            const endpoint = new Endpoint(GenericSwitchDevice.with(
                BridgedDeviceBasicInformationServer,
                ElectricalPowerMeasurementServer
            ), {
                id: this.tuya.id,
                parts,
                bridgedDeviceBasicInformation,
                electricalPowerMeasurement: {
                    activePower: 0,
                    activeCurrent: 0,
                    voltage: 220,
                    accuracy: [
                        {
                            measurementType: 0, // Voltage
                            accuracyRanges: [
                                {
                                    rangeMax: 25000, // 250V
                                    rangeMin: 0,
                                    fixedMax: 25000,
                                    fixedMin: 0,

                                    fixedTypical: 22000,
                                    percentMax: 1,
                                    percentMin: 1,
                                    percentTypical: 1
                                }
                            ],
                            maxMeasuredValue: 25000, // 250V
                            minMeasuredValue: 0,
                            measured: true
                        }
                    ], // 1%
                    numberOfMeasurementTypes: 4, // Voltage + Current + Power
                    powerMode: 0
                },
            })



            const observable = tuya.$dps.pipe(
                map(d => d.last),
                tap(dps => {
                    Object.entries(dps).forEach(([key, on]) => {
                        if (SWITCH_CODES.includes(key)) {
                            const target = endpoint.parts.get(key) as Endpoint<OnOffPlugInUnitDevice>
                            target?.set({ onOff: { onOff: !!on } })
                        }
                    })

                    const electricalPowerMeasurement: Partial<ElectricalPowerMeasurementBehavior.State> = {
                        ...dps.cur_current != undefined ? { activeCurrent: dps.cur_current } : {},
                        ...dps.cur_power != undefined ? { activePower: dps.cur_power } : {},
                        ...dps.cur_voltage != undefined ? { voltage: dps.cur_voltage } : {},
                    }

                    Object.keys(electricalPowerMeasurement).length > 0 && endpoint.set({
                        electricalPowerMeasurement
                    } as any)

                })
            )

            return {
                endpoint,
                observable
            }

        }






        const endpoint = new Endpoint(GenericSwitchDevice.with(
            BridgedDeviceBasicInformationServer
        ), {
            id: this.tuya.id,
            parts,
            bridgedDeviceBasicInformation
        })



        const observable = tuya.$dps.pipe(
            map(d => d.last),
            tap(dps => {
                Object.entries(dps).forEach(([key, on]) => {
                    if (SWITCH_CODES.includes(key)) {
                        const target = endpoint.parts.get(key) as Endpoint<OnOffPlugInUnitDevice>
                        target?.set({ onOff: { onOff: !!on } })
                    }
                })

            })
        )

        return {
            endpoint,
            observable
        }


    }


}