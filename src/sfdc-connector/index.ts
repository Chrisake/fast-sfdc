import { Config, MetaObj, AuraObj, AuraBundle } from '../fast-sfdc'
import * as SfdcConn from 'node-salesforce-connection'
import configService from '../services/config-service'
import utils from '../utils/utils'

let config: Config
configService.getConfig().then(cfg => config = cfg)
const conn = new SfdcConn()

const getBasePath = () => `/services/data/v${config.apiVersion}/tooling`
const rest = async function (endpoint: string, ...args: any[]) {
  try {
    if (!conn.sessionId) await connect()
    return await conn.rest(getBasePath() + endpoint, ...args)
  } catch (e) {
    if (e.code === 'ENOTFOUND') throw Error('Unreachable host. Check connection')
    else if (e.response && (e.response.statusCode === 401 || e.response.statusCode === 403)) {
      await connect()
      return conn.rest(getBasePath() + endpoint, ...args)
    } else {
      throw e
    }
  }
}

const post = async (endpoint: string, body: any) => rest(endpoint, { method: 'POST', body })
const patch = async (endpoint: string, body: any) => rest(endpoint, { method: 'PATCH', body })
const get = async (endpoint: string) => rest(endpoint)
const query = (q: string) => get(`/query?q=${encodeURIComponent(q.replace(/ +/g, ' '))}`)
const connect = async function (cfg?: Config) {
  if (cfg) config = cfg
  await conn.soapLogin({
    hostname: config.url,
    apiVersion: config.apiVersion,
    username: config.username,
    password: config.password
  })
}

export default {
  connect,
  query,

  async createMetadataContainer (name: string): Promise<string> {
    return (await post('/sobjects/MetadataContainer/', { name })).id
  },

  async upsertObj (toolingType: string, record: MetaObj | AuraObj | AuraBundle) {
    return (record.Id ? this.editObj : this.createObj)(toolingType, record)
  },

  async createObj (toolingType: string, record: MetaObj | AuraObj | AuraBundle) {
    return (await post(`/sobjects/${toolingType}`, record)).id
  },

  async editObj (toolingType: string, record: MetaObj | AuraObj | AuraBundle) {
    await patch(`/sobjects/${toolingType}/${record.Id}`, { ...record, Id: undefined, MetadataContainerId: undefined })
    return record.Id
  },

  upsertAuraObj: async (record: AuraObj) => exports.default.upsertObj('AuraDefinition', record),

  async createContainerAsyncRequest (metaContainerId: string): Promise<string> {
    return (await post('/sobjects/ContainerAsyncRequest/', {
      MetadataContainerId: metaContainerId,
      IsCheckOnly: false,
      IsRunTests: false
    })).id
  },

  async pollDeploymentStatus (containerAsyncRequestId: string) {
    let retryCount = 0
    while (true) {
      await utils.sleep(retryCount++ > 3 ? 1000 : 200)
      const res = await query(`SELECT
        Id,
        State,
        DeployDetails,
        ErrorMsg
        FROM ContainerAsyncRequest
        WHERE Id = '${containerAsyncRequestId}'`
      )
      if (res.records[0].State !== 'Queued') return res.records[0]
    }
  },

  findAuraByNameAndDefType: async (bundleName: string, auraDefType: string) => (await query(`SELECT
    Id
    FROM AuraDefinition
    WHERE AuraDefinitionBundle.DeveloperName = '${bundleName}'
    AND DefType = '${auraDefType}'
  `)).records[0]
}
