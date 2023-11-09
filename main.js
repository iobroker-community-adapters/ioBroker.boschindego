'use strict';

/*
 * Created with @iobroker/create-adapter v2.5.0
 */

const utils = require('@iobroker/adapter-core');
const crypto = require('crypto');
const axios = require('axios').default;
const qs = require('qs');
const Json2iob = require('json2iob');
const tough = require('tough-cookie');
const { HttpsCookieAgent } = require('http-cookie-agent/http');

class Boschindego extends utils.Adapter {
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  constructor(options) {
    super({
      ...options,
      name: 'boschindego',
    });
    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
    this.deviceArray = [];
    this.json2iob = new Json2iob(this);
    this.cookieJar = new tough.CookieJar();
    this.requestClient = axios.create({
      withCredentials: true,
      httpsAgent: new HttpsCookieAgent({
        cookies: {
          jar: this.cookieJar,
        },
      }),
    });
  }

  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    // Reset the connection indicator during startup
    this.setState('info.connection', false, true);
    if (this.config.interval < 0.5) {
      this.log.info('Set interval to minimum 0.5');
      this.config.interval = 0.5;
    }
    if (!this.config.username || !this.config.password) {
      this.log.error('Please set username and password in the instance settings');
      return;
    }

    this.updateInterval = null;
    this.reLoginTimeout = null;
    this.refreshTokenTimeout = null;
    this.session = {};
    this.subscribeStates('*.remote.*');

    this.log.info('Login to Bosch Indego');
    await this.login();

    if (this.session.access_token) {
      await this.getDeviceList();
      await this.updateDevices();
      this.updateInterval = setInterval(
        async () => {
          await this.updateDevices();
        },
        this.config.interval * 60 * 1000,
      );
      this.refreshTokenInterval = setInterval(
        async () => {
          await this.refreshToken();
        },
        (this.session.expires_in || 3600) * 1000,
      );
    }
  }

  async login() {
    let loginUrl = '';
    const formData = await this.requestClient({
      method: 'get',
      url: 'https://singlekey-id.com/auth/connect/authorize/callback',
      params: {
        prompt: 'login',
        client_id: '12E7F9D5-613D-444A-ACD3-838E4D974396',
        redirect_uri: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/oauth2/authresp',
        response_type: 'code',
        scope: 'openid profile email',
        response_mode: 'form_post',
        nonce: crypto.randomBytes(16).toString('base64'),
        state:
          'StateProperties=eyJTSUQiOiJ4LW1zLWNwaW0tcmM6NmEzNTY5YjUtOTRhNS00Y2U4LThkZTUtNDg3MmI0YjQ2NzQ5IiwiVElEIjoiNWUyYjU2MWQtZWQ5OS00MWU5LTkxMjEtMmEyZDQ2YjUyMWUyIiwiVE9JRCI6ImI4MTEzNjgxLWFlZjQtNDc0Yi05YmEyLTI1Mjk0Y2FhNDhmYyJ9',
        suppressed_prompt: 'login',
      },
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-de',
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 14_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1',
      },
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        loginUrl = res.request.path;
        return this.extractHidden(res.data);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    if (!formData) {
      this.log.error('Could not extract form data');
      return;
    }
    const loginParams = qs.parse(loginUrl.split('?')[1]);
    const token = this.cookieJar
      .getCookiesSync('https://singlekey-id.com/auth/')
      .find((cookie) => cookie.key === 'X-CSRF-FORM-TOKEN');
    const response = await this.requestClient({
      method: 'post',
      url: 'https://singlekey-id.com/auth/api/v1/authentication/login',
      headers: {
        requestverificationtoken: token.value,
        'content-type': 'application/json',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'de-de',
      },
      data: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        keepMeSignedIn: true,
        returnUrl: loginParams.ReturnUrl,
      }),
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        return await this.requestClient({
          method: 'get',
          url: 'https://singlekey-id.com' + res.data.returnUrl,
        });
      })
      .catch((error) => {
        if (error && error.message.includes('Unsupported protocol')) {
          return qs.parse(error.request._options.path.split('?')[1]);
        }
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        return;
      });
    if (!response) {
      return;
    }
    await this.requestClient({
      method: 'post',
      url: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/b2c_1a_signup_signin/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*',
        'User-Agent': 'Bosch/15752 CFNetwork/1240.0.4 Darwin/20.6.0',
        'Accept-Language': 'de-de',
        Authorization: 'Basic NjViYjhjOWQtMTA3MC00ZmI0LWFhOTUtODUzNjE4YWNjODc2Og==',
      },
      data:
        'code=' +
        response.code +
        '&code_verifier=dnGV08TXzwgUD-BqATS_WV0Sfh7lLVTAOB9CjC5H7zE&redirect_uri=msauth.com.bosch.indegoconnect.cloud://auth/&grant_type=authorization_code',
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.log.info('Login successful');
        this.setState('info.connection', true, true);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }
  extractHidden(body) {
    const returnObject = {};
    const matches = body.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g);
    for (const match of matches) {
      if (match[2] != null) {
        returnObject[match[1]] = match[2];
      }
    }
    return returnObject;
  }
  async getDeviceList() {
    await this.requestClient({
      method: 'put',
      url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/devices/active',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Connection: 'Keep-Alive',
        'User-Agent': 'Indego-Connect_4.0.3.12955',
        Authorization: 'Bearer ' + this.session.access_token,
      },
      data: {
        accept_tc_id: '202012',
        accept_dpn_id: '202012',
        app_version: '4.0.3',
        device:
          'eUJTd67jRcuLcceDWLnOFX:APA91bE9FVtylJgX940k8dclGV7zQPs7-yPkI48ybPWbwDtVU9VDH3AenxIINeVm1NBifYMgspjAVzBkPD54oBcFmH29R3pCVhECF5GzTBjFKRa0oiY5XIHtoqDhE42D988NT2OZLM0J',
        dvc_manuf: 'HUAWEI',
        dvc_type: 'ANE-LX1',
        os_type: 'Android',
        os_version: '9',
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        if (Array.isArray(res.data) === false) {
          res.data = [res.data];
        }

        this.log.info(`Found ${res.data.length} devices`);
        for (const device of res.data) {
          const id = device.alm_sn;

          this.deviceArray.push(id);
          const name = device.alm_sn;

          await this.setObjectNotExistsAsync(id, {
            type: 'device',
            common: {
              name: name,
            },
            native: {},
          });
          await this.setObjectNotExistsAsync(id + '.remote', {
            type: 'channel',
            common: {
              name: 'Remote Controls',
            },
            native: {},
          });

          const remoteArray = [{ command: 'Refresh', name: 'True = Refresh' }];
          remoteArray.forEach((remote) => {
            this.setObjectNotExists(id + '.remote.' + remote.command, {
              type: 'state',
              common: {
                name: remote.name || '',
                type: remote.type || 'boolean',
                role: remote.role || 'boolean',
                def: remote.def || false,
                write: true,
                read: true,
              },
              native: {},
            });
          });
          this.json2iob.parse(id, device, { forceIndex: true });
        }
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
  }

  async updateDevices() {
    const statusArray = [
      {
        path: 'state',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/state?longpoll=false&forceRefresh=true&timeout=0&last=1',
        desc: 'state',
      },
    ];

    for (const element of statusArray) {
      // const url = element.url.replace("$id", id);

      await this.requestClient({
        method: element.method || 'get',
        url: element.url,
        headers: {
          Connection: 'Keep-Alive',
          'User-Agent': 'Indego-Connect_4.0.3.12955',
          Authorization: 'Bearer ' + this.session.access_token,
        },
      })
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          if (!res.data) {
            return;
          }
          const data = res.data;

          const forceIndex = true;
          const preferedArrayName = null;

          this.json2iob.parse(element.path, data, {
            forceIndex: forceIndex,
            preferedArrayName: preferedArrayName,
            channelName: element.desc,
          });
          await this.setObjectNotExistsAsync(element.path + '.json', {
            type: 'state',
            common: {
              name: 'Raw JSON',
              write: false,
              read: true,
              type: 'string',
              role: 'json',
            },
            native: {},
          });
          this.setState(element.path + '.json', JSON.stringify(data), true);
        })
        .catch((error) => {
          if (error.response) {
            if (error.response.status === 401) {
              error.response && this.log.debug(JSON.stringify(error.response.data));
              this.log.info(element.path + ' receive 401 error. Refresh Token in 60 seconds');
              this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
              this.refreshTokenTimeout = setTimeout(() => {
                this.refreshToken();
              }, 1000 * 60);

              return;
            }
            if (error.response.status === 504) {
              this.log.info('Device is offline');
              return;
            }
          }
          this.log.error(element.url);
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
        });
    }
  }

  async refreshToken() {
    this.log.debug('Refresh token');

    await this.requestClient({
      method: 'post',
      url: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/b2c_1a_signup_signin/oauth2/v2.0/token',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: '*/*',
        'User-Agent': 'Bosch/15752 CFNetwork/1240.0.4 Darwin/20.6.0',
        'Accept-Language': 'de-de',
        Authorization: 'Basic NjViYjhjOWQtMTA3MC00ZmI0LWFhOTUtODUzNjE4YWNjODc2Og==',
      },
      data: qs.stringify({
        refresh_token: this.session.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        this.session = res.data;
        this.log.debug('Refresh successful');
        this.setState('info.connection', true, true);
      })
      .catch(async (error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
        this.setStateAsync('info.connection', false, true);
        await this.login();
      });
  }

  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   * @param {() => void} callback
   */
  onUnload(callback) {
    try {
      this.setState('info.connection', false, true);
      this.refreshTimeout && clearTimeout(this.refreshTimeout);
      this.reLoginTimeout && clearTimeout(this.reLoginTimeout);
      this.refreshTokenTimeout && clearTimeout(this.refreshTokenTimeout);
      this.updateInterval && clearInterval(this.updateInterval);
      this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
      callback();
    } catch (e) {
      callback();
    }
  }

  /**
   * Is called if a subscribed state changes
   * @param {string} id
   * @param {ioBroker.State | null | undefined} state
   */
  async onStateChange(id, state) {
    if (state) {
      if (!state.ack) {
        const deviceId = id.split('.')[2];
        const command = id.split('.')[4];
        if (id.split('.')[3] !== 'remote') {
          return;
        }

        if (command === 'Refresh') {
          this.updateDevices();
          return;
        }
      }
    }
  }
}
if (require.main !== module) {
  // Export the constructor in compact mode
  /**
   * @param {Partial<utils.AdapterOptions>} [options={}]
   */
  module.exports = (options) => new Boschindego(options);
} else {
  // otherwise start the instance directly
  new Boschindego();
}
