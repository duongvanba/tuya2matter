import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { AirQualitySensorDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer, CarbonDioxideConcentrationMeasurementServer, Pm10ConcentrationMeasurementServer, Pm1ConcentrationMeasurementServer, Pm25ConcentrationMeasurementServer, RelativeHumidityMeasurementServer, TemperatureMeasurementServer, TotalVolatileOrganicCompoundsConcentrationMeasurementServer } from "@matter/main/behaviors";
import { map, mergeMap } from "rxjs";
import { AirQuality, ConcentrationMeasurement, LevelControl } from "@matter/main/clusters";




export class Tuya2MatterAirSensor {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) {
    }

    link() {

        const name = this.tuya.name.slice(0, 32)

        const endpoint = new Endpoint(
            AirQualitySensorDevice.with(
                BridgedDeviceBasicInformationServer,
                TemperatureMeasurementServer,
                RelativeHumidityMeasurementServer,
                Pm1ConcentrationMeasurementServer.with(ConcentrationMeasurement.Feature.NumericMeasurement),
                Pm25ConcentrationMeasurementServer.with(ConcentrationMeasurement.Feature.NumericMeasurement),
                Pm10ConcentrationMeasurementServer.with(ConcentrationMeasurement.Feature.NumericMeasurement),
                TotalVolatileOrganicCompoundsConcentrationMeasurementServer.with(
                    ConcentrationMeasurement.Feature.NumericMeasurement,
                ),
            ),
            {
                id: this.tuya.id,
                bridgedDeviceBasicInformation: {
                    nodeLabel: name,
                    productName: name,
                    productLabel: name,
                    serialNumber: this.tuya.config.uuid,
                    reachable: false,
                },
                airQuality: {
                    airQuality: AirQuality.AirQualityEnum.Unknown,
                },
                relativeHumidityMeasurement: {

                    tolerance: 0,
                    minMeasuredValue: 0,
                    maxMeasuredValue: 10000,
                },
                temperatureMeasurement: {
                    tolerance: 0,
                    minMeasuredValue: 0,
                    maxMeasuredValue: 10000,
                    measuredValue: 22.5,
                },
                pm1ConcentrationMeasurement: {
                    measuredValue: 12.34,
                    measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                    measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
                },
                pm10ConcentrationMeasurement: {
                    measuredValue: 12.34,
                    measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                    measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
                },
                pm25ConcentrationMeasurement: {
                    measuredValue: 12.34,
                    measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                    measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
                },
                totalVolatileOrganicCompoundsConcentrationMeasurement: {
                    measuredValue: 0,
                    measurementUnit: ConcentrationMeasurement.MeasurementUnit.Ppm,
                    measurementMedium: ConcentrationMeasurement.MeasurementMedium.Air,
                },
            }
        )

        const airQualityMap = {
            'level_1': AirQuality.AirQualityEnum.Good,
            'level_2': AirQuality.AirQualityEnum.Fair,
            'level_3': AirQuality.AirQualityEnum.Moderate,
            'level_4': AirQuality.AirQualityEnum.Poor,
            'level_5': AirQuality.AirQualityEnum.VeryPoor,
            'level_6': AirQuality.AirQualityEnum.ExtremelyPoor,
        }


        const observable = this.tuya.$dps.pipe(
            map(d => d.last),
            mergeMap(async dps => { 
                endpoint.set({
                    airQuality: {
                        airQuality: airQualityMap[dps.air_quality_index as any] || AirQuality.AirQualityEnum.Unknown,
                    },
                    relativeHumidityMeasurement: {
                        measuredValue: (dps.humidity_value || 0) * 100,
                    },
                    temperatureMeasurement: {
                        measuredValue: (dps.temp_current || 0) * 100
                    },
                    pm1ConcentrationMeasurement: {
                        measuredValue: dps.pm1 || 0,
                    },
                    pm10ConcentrationMeasurement: {
                        measuredValue: dps.pm10 || 0,
                    },
                    pm25ConcentrationMeasurement: {
                        measuredValue: dps.pm25_value || 0,
                    }
                })

            })
        )

        return {
            endpoint: endpoint as Endpoint,
            observable
        }




    }


}