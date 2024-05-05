'use strict';

/*
 * Created with @iobroker/create-adapter v2.5.0
 */

const utils = require('@iobroker/adapter-core');
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
      timeout: 3 * 60 * 1000, //3min client timeout
      httpsAgent: new HttpsCookieAgent({
        cookies: {
          jar: this.cookieJar,
        },
      }),
    });
    this.alerts = {};
    this.lastState = {};
    this.lastData = {};
    this.lastMap = {};
    this.states = {
      state: {
        0: 'Reading status',
        257: 'Charging',
        258: 'Docked',
        259: 'Docked - Software update',
        260: 'Docked',
        261: 'Docked',
        262: 'Docked - Loading map',
        263: 'Docked - Saving map',
        513: 'Mowing',
        514: 'Relocalising',
        515: 'Loading map',
        516: 'Learning lawn',
        517: 'Paused',
        518: 'Border cut',
        519: 'Idle in lawn',
        769: 'Returning to Dock',
        770: 'Returning to Dock',
        771: 'Returning to Dock - Battery low',
        772: 'Returning to dock - Calendar timeslot ended',
        773: 'Returning to dock - Battery temp range',
        774: 'Returning to dock',
        775: 'Returning to dock - Lawn complete',
        776: 'Returning to dock - Relocalising',
        1025: 'Diagnostic mode',
        1026: 'EOL Mode',
        1281: 'Software update',
        1537: 'Low power mode',
        64513: 'Docked - Waking up',
      },
    };
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
    if (this.config.interval > 2147483647) {
      this.log.info('Set interval to maximum 2147483647');
      this.config.interval = 2147483647;
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
        (this.session.expires_in - 100 || 3500) * 1000,
      );
    }
  }

  async login() {
    const loginForm = await this.requestClient({
      method: 'get',
      url: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/b2c_1a_signup_signin/oauth2/v2.0/authorize',
      params: {
        nonce: 'b_x1uhAjiy3iKMcXX1TKbJnBph18-J_Hms4vvWeE7qw',
        response_type: 'code',
        code_challenge_method: 'S256',
        scope:
          'openid profile email https://prodindego.onmicrosoft.com/indego-mobile-api/Indego.Mower.User offline_access',
        code_challenge: '5C1HXuvfGjAo-6TVzy_95lQNmpAjorsngCwiD3w3VHs',
        redirect_uri: 'msauth.com.bosch.indegoconnect.cloud://auth/',
        client_id: '65bb8c9d-1070-4fb4-aa95-853618acc876',
        state: 'aylWn_85vBUdNlHPC_KeGoqrcsyi5VCxjQjvttvD85g',
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
        return JSON.parse(res.data.split('var SETTINGS = ')[1].split(';')[0]);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    if (!loginForm || !loginForm.csrf || !loginForm.transId) {
      this.log.error('Could not extract login form');
      this.log.error(JSON.stringify(loginForm));
      return;
    }
    let formData = '';

    const loginParams = await this.requestClient({
      method: 'get',
      url: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/B2C_1A_signup_signin/api/CombinedSigninAndSignup/unified',
      params: {
        claimsexchange: 'BoschIDExchange',
        csrf_token: loginForm.csrf,
        tx: loginForm.transId,
        p: 'B2C_1A_signup_signin',
        diags:
          '{"pageViewId":"281eab4f-ef89-4f5c-a546-ffad0bb1b00b","pageId":"CombinedSigninAndSignup","trace":[{"ac":"T005","acST":1699567715,"acD":1},{"ac":"T021 - URL:https://swsasharedprodb2c.blob.core.windows.net/b2c-templates/bosch/unified.html","acST":1699567715,"acD":712},{"ac":"T019","acST":1699567716,"acD":9},{"ac":"T004","acST":1699567716,"acD":4},{"ac":"T003","acST":1699567716,"acD":1},{"ac":"T035","acST":1699567716,"acD":0},{"ac":"T030Online","acST":1699567716,"acD":0},{"ac":"T002","acST":1699567791,"acD":0}]}',
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
        formData = this.extractHidden(res.data);
        return qs.parse(res.request.path.split('?')[1]);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });

    if (!loginParams || !loginParams.ReturnUrl) {
      this.log.error('Could not extract login params');
      this.log.error(JSON.stringify(loginParams));
      return;
    }
    // const token = this.cookieJar.getCookiesSync('https://singlekey-id.com/auth/').find((cookie) => cookie.key === 'X-CSRF-FORM-TOKEN');
    const userResponse = await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://singlekey-id.com/auth/de-de/login',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: '*/*',
        'hx-request': 'true',
        'sec-fetch-site': 'same-origin',
        'hx-boosted': 'true',
        'accept-language': 'de-DE,de;q=0.9',
        'sec-fetch-mode': 'cors',
        origin: 'https://singlekey-id.com',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'sec-fetch-dest': 'empty',
      },
      params: loginParams,
      data: {
        'UserIdentifierInput.EmailInput.StringValue': this.config.username,
        __RequestVerificationToken: formData['undefined'],
      },
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return this.extractHidden(res.data);
      })
      .catch((error) => {
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
      });
    if (!userResponse) {
      this.log.error('Could not extract user data');
      return;
    }
    await this.requestClient({
      method: 'post',
      maxBodyLength: Infinity,
      url: 'https://singlekey-id.com/auth/de-de/login/password',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: '*/*',
        'hx-request': 'true',
        'sec-fetch-site': 'same-origin',
        'hx-boosted': 'true',
        'accept-language': 'de-DE,de;q=0.9',
        'sec-fetch-mode': 'cors',
        origin: 'https://singlekey-id.com',
        'user-agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'sec-fetch-dest': 'empty',
      },
      params: loginParams,
      data: {
        Password: this.config.password,
        RememberMe: 'true',
        __RequestVerificationToken: userResponse['undefined'],
      },
    }).catch((error) => {
      this.log.error(error);
      error.response && this.log.error(JSON.stringify(error.response.data));
    });

    const htmlForm = await this.requestClient({
      method: 'get',
      url: 'https://singlekey-id.com' + loginParams.ReturnUrl,
    });
    const formDataAuth = this.extractHidden(htmlForm.data);
    const response = await this.requestClient({
      method: 'post',
      url: 'https://prodindego.b2clogin.com/prodindego.onmicrosoft.com/oauth2/authresp',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json, text/plain, */*',
        'accept-language': 'de-de',
      },
      data: formDataAuth,
    })
      .then((res) => {
        this.log.debug(JSON.stringify(res.data));
        return;
      })
      .catch((error) => {
        if (error && error.message.includes('Unsupported protocol')) {
          return qs.parse(error.request._options.path.split('?')[1]);
        }
        this.log.error(error);
        error.response && this.log.error(JSON.stringify(error.response.data));
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
        '&code_verifier=nw0c1JmU5rIszzrUOFj1BFvaqOynWrZ6ZHSVOMisZ7o&redirect_uri=msauth.com.bosch.indegoconnect.cloud://auth/&grant_type=authorization_code',
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
        dvc_manuf: 'SAMSUNG',
        dvc_type: 'S901B/DS',
        os_type: 'Android',
        os_version: '13',
      },
    })
      .then(async (res) => {
        this.log.debug(JSON.stringify(res.data));
        if (Array.isArray(res.data) === false) {
          if (!res.data.alm_sn) {
            this.log.error('No device found');
            return;
          }
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

          const remoteArray = [
            { command: 'Refresh', name: 'True = Refresh' },
            { command: 'state_mow', name: 'True = Mow' },
            { command: 'state_pause', name: 'True = Pause' },
            { command: 'state_returnToDock', name: 'True = Pause' },
            { command: 'reset_blade', name: 'True = Reset Blades' },
            { command: 'reset_alerts', name: 'True = Reset Alerts' },
            { command: 'calendar_get', name: 'True = Get' },
            {
              command: 'calendar_set',
              name: 'Set Calendar as JSON',
              type: 'string',
              role: 'json',
              def: `{
              "sel_cal": 1,
              "cals": [
                {
                  "cal": 1,
                  "days": [
                    {
                      "day": 0,
                      "slots": [
                        {
                          "En": true,
                          "EnHr": 23,
                          "EnMin": 59,
                          "StHr": 22,
                          "StMin": 0
                        },
                        {
                          "En": true,
                          "EnHr": 8,
                          "EnMin": 0,
                          "StHr": 0,
                          "StMin": 0
                        }
                      ]
                    },
                    {
                      "day": 1,
                      "slots": [
                        {
                          "En": true,
                          "EnHr": 23,
                          "EnMin": 59,
                          "StHr": 22,
                          "StMin": 0
                        },
                        {
                          "En": true,
                          "EnHr": 8,
                          "EnMin": 0,
                          "StHr": 0,
                          "StMin": 0
                        }
                      ]
                    },
                    {
                      "day": 6,
                      "slots": [
                        {
                          "En": true,
                          "EnHr": 23,
                          "EnMin": 59,
                          "StHr": 22,
                          "StMin": 0
                        },
                        {
                          "En": true,
                          "EnHr": 8,
                          "EnMin": 0,
                          "StHr": 0,
                          "StMin": 0
                        }
                      ]
                    }
                  ]
                }
              ]
            }
            `,
            },
            { command: 'predictive_enable', name: 'True = Enable, False Disable' },
            {
              command: 'predictive_useradjustment',
              name: '-100 to 100',
              type: 'number',
              role: 'level',
              def: 0,
              min: -100,
              max: 100,
            },
          ];
          remoteArray.forEach((remote) => {
            this.extendObject(id + '.remote.' + remote.command, {
              type: 'state',
              common: {
                name: remote.name || '',
                type: remote.type || 'boolean',
                role: remote.role || 'boolean',
                def: remote.def == null ? false : remote.def,
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

  async updateDevices(selection) {
    let statusArray = [
      {
        path: 'state',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/state?longpoll=false&forceRefresh=true&timeout=0',
        desc: 'State',
      },
      {
        path: 'alerts',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alerts',
        desc: 'Alerts',
      },
      {
        path: 'predictive',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/predictive',
        desc: 'Predictive',
      },
      {
        path: 'operatingData',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/operatingData',
        desc: 'Operating Data',
      },
      {
        path: 'lastcutting',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/predictive/lastcutting',
        desc: 'Last Cutting',
      },
      {
        path: 'nextcutting',
        url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/predictive/nextcutting',
        desc: 'Next Cutting',
      },
    ];

    if (selection === 'calendar') {
      statusArray = [
        {
          path: 'calendar',
          url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/predictive/calendar',
          desc: 'Calendar',
        },
      ];
    }

    for (const id of this.deviceArray) {
      if (
        (this.config.getMap && this.lastState[id] == null) ||
        (this.lastState[id] >= 500 && this.lastState[id] <= 799)
      ) {
        this.log.debug('Add map to update because of state ' + this.lastState[id]);
        statusArray.push({
          path: 'map',
          url: 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/$id/map',
          desc: 'Map',
        });
      }
      for (const element of statusArray) {
        const url = element.url.replace('$id', id);
        await this.requestClient({
          method: element.method || 'get',
          url: url,
          headers: {
            Connection: 'Keep-Alive',
            'User-Agent': 'Indego-Connect_4.0.3.12955',
            Authorization: 'Bearer ' + this.session.access_token,
            'x-im-context-id': this.session.resource,
          },
        })
          .then(async (res) => {
            this.log.debug(url);
            this.log.debug(JSON.stringify(res.data));
            if (!res.data) {
              return;
            }
            let data = res.data;

            const forceIndex = true;
            const preferedArrayName = null;
            if (element.path === 'alerts') {
              this.alerts[id] = data;
            }
            if (element.path === 'state') {
              this.lastState[id] = data.state;
              this.lastData[id] = data;
              if (data.svg_xPos && data.svg_yPos && this.lastMap[id] != null) {
                const map = this.addLocationtoMap(data, this.lastMap[id]);
                this.json2iob.parse(id + '.map', map, {
                  forceIndex: forceIndex,
                  preferedArrayName: preferedArrayName,
                  channelName: element.desc,
                  states: this.states,
                });
              }
            }
            if (element.path === 'map') {
              if (!this.lastData[id].svg_xPos || !this.lastData[id].svg_yPos) {
                this.log.info('No mower location found to add in the map' + JSON.stringify(data));
                return;
              }
              this.lastMap[id] = data;
              data = this.addLocationtoMap(this.lastData[id], this.lastMap[id]);
            }
            this.json2iob.parse(id + '.' + element.path, data, {
              forceIndex: forceIndex,
              preferedArrayName: preferedArrayName,
              channelName: element.desc,
              states: this.states,
            });
            if (element.path != 'map') {
              await this.setObjectNotExistsAsync(id + '.' + element.path + '.json', {
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
            }
            this.setState(id + '.' + element.path + '.json', JSON.stringify(data), true);
          })
          .catch((error) => {
            this.log.debug(url);
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
                this.log.warn('Device is offline');
                return;
              }
            }
            this.log.error(element.url);
            this.log.error(error);
            error.response && this.log.error(JSON.stringify(error.response.data));
          });
      }
    }
  }
  addLocationtoMap(state, map) {
    //add location to map
    map = map.replace(
      '</svg>',
      `<circle cx="${state.svg_xPos}" cy="${state.svg_yPos}" r="20" stroke="black" stroke-width="3" fill="yellow"/> </svg>`,
    );
    //transparent background
    map = map.replace('ry="0" fill="#FAFAFA"', 'ry="0" fill="#00000" fill-opacity="0.0"');
    return map;
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
        const type = command.split('_')[0];
        const exec = command.split('_')[1];

        let data = {};
        let method = 'put';
        const baseUrl = 'https://api.indego-cloud.iot.bosch-si.com/api/v1/alms/' + deviceId;
        const urlArray = [];
        if (type === 'state') {
          urlArray.push(baseUrl + '/state');
          data = { state: exec };
        }
        if (type === 'predictive') {
          if (exec === 'useradjustment') {
            urlArray.push(baseUrl + '/predictive/useradjustment');
            data = {
              user_adjustment: state.val,
            };
          }
          if (exec === 'enable') {
            urlArray.push(baseUrl + '/predictive');
            data = {
              enabled: state.val,
            };
          }
        }
        if (type === 'reset') {
          urlArray.push(baseUrl);
          if (exec === 'blade') {
            data = {
              needs_service: false,
            };
          }
          if (exec === 'alerts') {
            method = 'delete';
            for (const alert of this.alerts[deviceId]) {
              urlArray.push(baseUrl + '/alerts/' + alert.id);
            }
          }
        }
        if (type === 'calendar') {
          urlArray.push(baseUrl + '/predictive/calendar');
          if (exec === 'get') {
            this.updateDevices('calendar');
            return;
          }
          if (exec === 'set') {
            data = JSON.parse(state.val?.toString() || '{}');
          }
        }
        for (const url of urlArray) {
          this.log.debug(url);
          await this.requestClient({
            method: method,
            url: url,
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              Connection: 'Keep-Alive',
              'User-Agent': 'Indego-Connect_4.0.3.12955',
              Authorization: 'Bearer ' + this.session.access_token,
              'x-im-context-id': this.session.resource,
            },
            data: data,
          })
            .then(async (res) => {
              this.log.debug(JSON.stringify(res.data));
            })
            .catch((error) => {
              if (error.response && error.response.status === 504) {
                this.log.warn('Device is offline');
                return;
              }
              this.log.error(error);
              error.response && this.log.error(JSON.stringify(error.response.data));
            });
        }
        this.refreshTimeout && clearTimeout(this.refreshTimeout);
        this.refreshTimeout = setTimeout(() => {
          this.updateDevices();
        }, 10 * 1000);
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
