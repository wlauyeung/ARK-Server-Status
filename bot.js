const Discord = require('discord.js');
const Gamedig = require('gamedig');
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler');
const fs = require('fs');
const config = require('./config.json');
const serverList = require('./servers.json');
const guildList = require('./guilds.json');
const client = new Discord.Client();
const axios = require('axios').default;

class Server {
  constructor(name, ip, port) {
    this.name = name;
    this.data = null;
    this.uuid = name;
    this.status = 0;
    this.ip = ip;
    this.port = port;
    this.offlineCounter = 0;
  }

  getChannelDisplayName() {
    const statusText = (this.status === 0) ? 'Off' : 'On';
    const names = this.name.split('-');
    return names[names.length - 1].slice(-16) + ': ' + statusText;
  }

  changeStatus(status) {
    if (this.status !== status) {
      const statusText = (status === 0) ? 'offline' : 'online';
      this.status = status;
      for (const guildID of Object.keys(guildList.guilds)) {
        if (guildList.guilds[guildID].trackedServers[this.name]) {
          const guild = client.guilds.cache.find((g => g.id === guildID));
          if (guild) {
            updateChannel(this.getChannelDisplayName(), 
            guildList.guilds[guildID].trackedServers[this.name])
            .catch(e => console.error(e));
            sendMessage(this.name + ' is now ' + statusText + '!', guild.id);
          }
        }
      }
    }
  }

  async update() {
    try {
      this.data = await Gamedig.query({
        type: 'arkse',
        host: this.ip,
        port: this.port
      });
      this.changeStatus(1);
      this.offlineCounter = 0;
    } catch(e) {
      this.offlineCounter++;
      if (this.offlineCounter > config.offlineCounterThreshold) {
        this.changeStatus(0);
      }
    }
  }

  async isPlayerOn(playerName) {
    if (await this.getData() === null) {
      return false;
    }
    for (const player of this.data.players) {
      if (player.name === playerName) {
        return true;
      }
    }
    return false;
  }

  async getData() {
    if (this.data === null) {
      await this.update();
    }
    return this.data;
  }
}

class OfficialServersUpdater {
  constructor(serversHandler) {
    this.ports = [27015, 27017, 27019, 27021];
    this.progress = 0;
    this.serversHandler = serversHandler;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  queryServer(serverIP, port) {
    return new Promise((resolve) => {
      Gamedig.query({
        type: 'arkse',
        host: serverIP,
        port: port
      }).then(state => {
          const name = state.name.replace(/\s-\s\(.+\)/gm, '');
          if (name !== null) {
            serverList.servers[name] = {
              ip: serverIP,
              port: port,
              tracked: false
            };
            this.progress++;
          }
        }).catch(e => {
          this.progress++;
        });
      resolve(1);
    });
  }

  async run() {
    try {
      const res = await axios.get('http://arkdedicated.com/officialservers.ini');
      const arkServers = res.data.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/gm);
      const numServers = arkServers.length * this.ports.length;

      console.log('Updating all official servers');
      for (const serverIP of arkServers) {
        for (const port of this.ports) {
          this.queryServer(serverIP, port);
          await this.sleep(1);
        }
      }
      while (this.progress !== numServers) {
        console.log(`Progress: ${this.progress}/${numServers}`)
        await this.sleep(1000);
      }
      for (const serverName of Object.keys(this.serversHandler.servers)) {
        const server = this.serversHandler.servers[serverName];
        serverList.servers[server.name].tracked = true;
        server.ip = serverList.servers[server.name].ip;
        server.port = serverList.servers[server.name].port;
        console.log(`${server.ip}:${server.port}`);
        server.update();
      }
      this.serversHandler.saveServers();
      this.progress = 0;
      console.log(`Update completed!`);
    } catch(e) {
      console.error(e);
    }
  }
}

class ServersHandler {
  constructor() {
    this.servers = {};
    this.serversUpdater = new OfficialServersUpdater(this);
    const scheduler = new ToadScheduler();
    const queryTask = new Task('update servers', (sh=this) => {sh.updateServers()});
    const queryJob = new SimpleIntervalJob({ seconds: config.queryInterval}, queryTask);
    const updateTask = new Task('update server lists', (su=this.serversUpdater) => {su.run()});
    const updateJob = new SimpleIntervalJob({ days: config.serverListUpdateInterval}, updateTask);

    for (const uuid of Object.keys(serverList.servers)) {
      const serverData = serverList.servers[uuid];
      if (serverData.tracked) {
        this.servers[uuid] = new Server(uuid, serverData.ip, serverData.port);
      }
    }

    scheduler.addSimpleIntervalJob(queryJob);
    scheduler.addSimpleIntervalJob(updateJob);

    this.serversUpdater.run();
  }

  saveServers() {
    fs.writeFile('./servers.json', JSON.stringify(serverList, null, 2), err => {
      if (err) console.error(err);
    });
  }

  async updateServers() {
    for (const uuid of Object.keys(this.servers)) {
      this.servers[uuid].update();
    }
  }

  getUUIDsFromName(serverName, tracked, guildID='') {
    if (tracked && guildID === '') {
      throw 'empty guild id';
    }
    const list = [];
    const servers = (tracked) ? this.getTrackedServersAsList(guildID) : Object.keys(serverList.servers);
    for (const server of servers) {
      if (server.toLowerCase().includes(serverName.toLowerCase())) {
        list.push(server);
      }
    }
    return list;
  }

  trackServer(serverName) {
    const serverData = serverList.servers[serverName];
    if (serverData !== undefined
        && !serverData.tracked) {
      serverData.tracked = true;
      this.servers[serverName] = new Server(serverName, serverData.ip, serverData.port);
      this.saveServers();
      return true;
    }
    return false;
  }

    untrackServer(serverName) {
      if (this.servers[serverName] !== undefined) {
        serverList.servers[serverName].tracked = false;
        delete this.servers[serverName];
        this.saveServers();
        return true;
      }
      return false;
    }

  getServer(uuid) {
    if (this.servers[uuid] !== undefined) {
      return this.servers[uuid];
    }
    return null;
  }

  getServersAsList() {
    return Object.keys(serverList.servers);
  }

  getTrackedServersAsList(guildID) {
    if (!guildID || guildID === '') {
      throw 'empty guild id';
    }
    return Object.keys(guildList.guilds[guildID].trackedServers);
  }

  hasServer(uuid) {
    return this.servers[uuid] === undefined;
  }

  getServerStatus(uuid) {
    return this.servers[uuid].status;
  }

  getAllTrackedServersStatus(guildID) {
    const status = {};
    for (const server of this.getTrackedServersAsList(guildID)) {
      status[server.name] = this.getServerStatus(server.uuid);
    }
    return status;
  }
}

function saveGuild() {
  fs.writeFile('./guilds.json', JSON.stringify(guildList, null, 2), err => {
    if (err) console.error(err);
  });
}

function sendMessage(message, guildID) {
  if (guildList.guilds[guildID] && guildList.guilds[guildID].channelID) {
    const channelID = guildList.guilds[guildID].channelID;
    if (channelID !== '') {
      const channel = client.channels.cache.get(channelID);
      if (channel !== undefined) {
        channel.send(message);
      }
    }
  }
}

function vaildateArgsLength(commandName, args, length, channel, shouldSendMsg=true) {
  if (args.length !== length) {
    if (config.commands[commandName] !== undefined) {
      if (shouldSendMsg) {
        channel.send(`${config.prefix}${commandName} ${config.commands[commandName].usage}`);
      }
    } else {
      if (shouldSendMsg) {
        console.error('Unable to find command \"' + commandName + "\"");
      }
    }
    return false;
  } else {
    return true;
  }
}

function setNotificationChannel(msg, arg) {
  const channelID = arg.replace('<', '').replace('>', '').replace('#', '');
  if (client.channels.cache.get(channelID) !== undefined) {
    guildList.guilds[msg.guild.id].channelID = channelID;
    saveGuild();
    msg.channel.send('News channel has been set to ' + arg);
  } else {
    msg.channel.send('Invalid channel');
  }
}

async function trackServer(msg, serverName) {
  let uuids = serversHandler.getUUIDsFromName(serverName, false);
  if (uuids.length > 1 && uuids.length < 20) {
    let foundExactName = false;
    for (const uuid of uuids) {
      if (uuid === serverName) {
        foundExactName = true;
        uuids = [uuid];
      }
    }
    if (!foundExactName) {
      let reply = 'Did you mean:'
      for (const uuid of uuids) {
        reply += `\n${uuid}`;
      }
      msg.channel.send(reply);
      return;
    }
  } else if (uuids.length > 20) {
    msg.channel.send('Please be more specific');
    return;
  }
  if (uuids.length === 1) {
    if (guildList.guilds[msg.guild.id]) {
      if (!guildList.guilds[msg.guild.id].trackedServers[uuids[0]]) {
        if (!serverList.servers[uuids[0]].tracked) {
          serversHandler.trackServer(uuids[0]);
        }
        guildList.guilds[msg.guild.id].trackedServers[uuids[0]] = (await createChannel(msg.guild, 
          serversHandler.getServer(uuids[0]).getChannelDisplayName())).id;
        saveGuild();
        msg.channel.send(uuids[0] + ' has been added to the tracking list');
      } else {
        msg.channel.send(uuids[0] + ' is already on the tracking list');
      }
    } else {
      console.error('guild id not found');
    }
  } else {
    msg.channel.send('Unable to find server with name ' + serverName);
  }
}

function untrackServer(msg, serverName) {
  const uuids = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
  if (uuids.length > 1 && uuids.length < 20) {
    let reply = 'Did you mean:'
    for (const uuid of uuids) {
      reply += `\n${uuid}`;
    }
    msg.channel.send(reply);
  } else if (uuids.length > 20) {
    msg.channel.send('Please be more specific');
  } else if (uuids.length === 1) {
    if (guildList.guilds[msg.guild.id]) {
      if (guildList.guilds[msg.guild.id].trackedServers[uuids[0]]) {
        let isTrackedOnElseWhere = false;
        for (const guildID of Object.keys(guildList.guilds)) {
          if (guildList.guilds[guildID].trackedServers[uuids[0]] && guildID !== msg.guild.id) {
            isTrackedOnElseWhere = true;
            break;
          }
        }
        if(!isTrackedOnElseWhere) {
          serversHandler.untrackServer(uuids[0]);
        }
        deleteChannel(guildList.guilds[msg.guild.id].trackedServers[uuids[0]]);
        delete guildList.guilds[msg.guild.id].trackedServers[uuids[0]];
        saveGuild();
        msg.channel.send(uuids[0] + ' has been removed from the tracking list');
      } else {
        msg.channel.send(uuids[0] + ' is not tracked');
      }
    } else {
      console.error('guild id not found');
    }
  } else {
    msg.channel.send('Unable to find server with name ' + serverName);
  }
}

function listServersStatus(msg) {
  const serversStatus = guildList.guilds[msg.guild.id].trackedServers;  
  let list = 'Currently tracking:';
  for (const serverName of Object.keys(serversStatus)) {
    const status = (serversStatus[serverName] === 0) ? ' (Offline)' : ' (Online)';
    list += '\n' + serverName + status;
  }
  msg.channel.send(list);
}

async function stalk(msg, playerName, serverName=null) {
  const uuids = (serverName !== null) ? 
    serversHandler.getUUIDsFromName(serverName, true, msg.guild.id) : serversHandler.getTrackedServersAsList(msg.guild.id);
  if (serverName === null && uuids.length === 0) {
    msg.channel.send('Not tracking any server')
    return;
  } 
  let isOnline = false;
  if (uuids.length < 1) {
    msg.channel.send('Unknown server');
    return;
  }
  for (const uuid of uuids) {
    if (uuid !== null) {
      isOnline = await serversHandler.getServer(uuid).isPlayerOn(playerName);
      if (isOnline) {
        msg.channel.send(playerName + ' is currently on ' + serversHandler.getServer(uuid).name);
        break;
      }
    }
  }
  if (!isOnline) {
    if(serverName !== null) {
      msg.channel.send(playerName + ' is not on any severs containing ' + serverName);
    } else {
      msg.channel.send(playerName + ' is not on any tracked servers');
    }
  }
}

function checkServerStatus(msg, serverName) {
  const uuids = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
  if (uuids.length === 0) {
    msg.channel.send('Unknown Server');
    return;
  }
  for (uuid of uuids) {
    const status = (serversHandler.getServerStatus(uuid) === 0) ? 'offline' : 'online';
    found = true;
    msg.channel.send(serversHandler.getServer(uuid).name + ' is ' + status);
  }
}

async function listPlayers(msg, serverName) {
  const uuids = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
  if (uuids.length > 0) {
    for (const uuid of uuids) {
      let str = '';
      const server = serversHandler.getServer(uuid);
      if (serversHandler.getServerStatus(uuid) !== 0) {
        str += '\nList of players on ' + server.name + ':';
        for (const player of (await server.getData()).players) {
          str += '\n' + player.name;
        }
        msg.channel.send(str.substring(1));
      } else {
        msg.channel.send(server.name + ' is offline');
      }
    }
  } else {
    msg.channel.send('Unknown Server');
  }
}

async function updateChannel(name, channelID) {
  try {
    if (channelID !== undefined) {
      const channel = client.channels.cache.get(channelID);
      if (channel !== undefined) {
        channel.setName(name);
        return channel;
      }
      throw 'channel not found';
    }
  } catch(e) {
    throw e;
  }
}

async function createChannel(guild, name) {
  try {
    let category = guild.channels.cache.find(c => c.name === 'Tracked Servers' && c.type === "category");
    if (!category) {
      category = await guild.channels.create('Tracked Servers', {type: 'category'});
    }
    const everyoneRoleID = guild.roles.everyone.id;
    const channel = await guild.channels.create(name, {
      type: 'voice',
      parent: category.id,
      permissionOverwrites: [
        {
          id: everyoneRoleID,
          deny: ['CONNECT']
        }
      ]
    });
    return channel;
  } catch(e) {
    throw e;
  }
}

async function deleteChannel(channelID) {
  try {
    const channel = client.channels.cache.find(c => c.id === channelID);
    if (channel) {
      await channel.delete();
    }
  } catch(e) {
    throw e;
  }
}

async function getRates(msg) {
  try {
    const res = await axios.get('http://arkdedicated.com/dynamicconfig.ini');
    msg.channel.send(res.data);
  } catch(e) {
    msg.channel.send('Unable to fetch data');
  }
}

const serversHandler = new ServersHandler();

client.on('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  serversHandler.updateServers();
});

client.on('message', msg => {
  if (!msg.content.startsWith(config.prefix) 
    || msg.author.bot || !msg.guild) return;
  const args = msg.content.slice(1).match(/"[^"]+"|[^\s]+/gm);
  if (!guildList.guilds[msg.guild.id]) {
    guildList.guilds[msg.guild.id] = {
      channelID: msg.channel.id,
      trackedServers: {}
    }
    saveGuild();
  }
  if (args === null) {
    return;
  }
  for (let i = 0; i < args.length; i++) {
    args[i] = args[i].replaceAll('"', '');
  }
  const command = args.shift().toLowerCase();
  if (command === 'setchannel' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    setNotificationChannel(msg, args[0]);
  } else if (command === 'track' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    trackServer(msg, args[0]);
  } else if (command === 'untrack' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    untrackServer(msg, args[0]);
  } else if (command === 'list') {
    listServersStatus(msg);
  } else if (command === 'stalk') {
    if (vaildateArgsLength(command, args, 2, msg.channel, false)) {
      stalk(msg, args[1], args[0]);
    } else if (vaildateArgsLength(command, args, 1, msg.channel)) {
      stalk(msg, args[0]);
    }
  } else if (command === 'status') {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    checkServerStatus(msg, args[0]);
  } else if (['listplayers', 'lp'].includes(command)) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    listPlayers(msg, args[0]);
  } else if (command === 'rates') {
    getRates(msg);
  }
});

client.login(config.token);