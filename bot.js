const Discord = require('discord.js');
const Gamedig = require('gamedig');
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler');
const fs = require('fs');
const config = require('./config.json');
const serverList = require('./servers.json');
const client = new Discord.Client();
const { v4: uuidv4 } = require('uuid');

class Server {
  constructor(name, uuid) {
    this.name = name;
    this.data = null;
    this.uuid = uuid;
    this.status = 0;
    this.offlineCounter = 0;
    this.update();
  }

  changeStatus(status) {
    if (this.status !== status) {
      const statusText = (status === 0) ? 'offline' : 'online';
      sendMessage(this.name + ' is now ' + statusText + '!');
      if (serverList.servers[this.uuid].channelID !== undefined) {
        const channel = client.channels.cache.get(serverList.servers[this.uuid].channelID);
        if (channel !== undefined) {
          channel.setName(getServerDisplayName(this.name, status));
        }
      }
      this.status = status;
    }
  }

  async update() {
    try {
      this.data = await Gamedig.query({
        type: 'arkse',
        host: serverList.servers[this.uuid].ip,
        port: serverList.servers[this.uuid].port
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
    for (const player of (await this.getData()).players) {
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

class ServersHandler {
  constructor() {
    this.servers = {};
    const scheduler = new ToadScheduler();
    const task = new Task('update servers', (sh=this) => {sh.updateServers()});
    const job = new SimpleIntervalJob({ seconds: config.queryInterval}, task);

    for (const uuid of Object.keys(serverList.servers)) {
      const serverData = serverList.servers[uuid];
      this.servers[uuid] = new Server(serverData.name, uuid);
    }
    scheduler.addSimpleIntervalJob(job);
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

  getUUIDsFromName(serverName) {
    const list = [];
    for (const server of this.getServersAsList()) {
      if (server.name.toLowerCase().includes(serverName.toLowerCase())) {
        list.push(server.uuid);
      }
    }
    return list;
  }

  async trackServer(serverName, ip, port, guild) {
    const uuid = uuidv4();
    const category = guild.channels.cache.find(c => c.name == 'Tracked Servers' && c.type == "category");
    const everyoneRole = guild.roles.everyone.id;
    this.servers[uuid] = new Server(serverName, uuid);
    serverList.servers[uuid] = {name: serverName, ip: ip, port: port};
    if (category) {
      const channel = await guild.channels.create(serverName, {
        type: 'voice',
        parent: category.id,
        permissionOverwrites: [
          {
            id: everyoneRole,
            deny: ['CONNECT']
          }
        ]
      });
      serverList.servers[uuid].channelID = channel.id;
      channel.setName(getServerDisplayName(serverName, this.servers[uuid].status));
    }
    this.saveServers();
  }

  trackServers(servers, guild) {
    for (const server of servers) {
      this.trackServer(server.name, server.ip, server.port, guild);
    }
  }

  untrackServer(serverName) {
    let serverUUID = null;
    for (const uuid of Object.keys(this.servers)) {
      if (this.servers[uuid].name === serverName) {
        serverUUID = uuid;
        break;
      }
    }
    if (serverUUID !== null) {
      const category = client.channels.cache.find(c => c.name == 'Tracked Servers' && c.type == "category");
      if (category) {
        const channel = client.channels.cache.find(c => c.id === serverList.servers[serverUUID].channelID);
        if (channel) {
          channel.delete();
        }
      }
      delete this.servers[serverUUID];
      delete serverList.servers[serverUUID];
      this.saveServers();
      return true;
    } else {
      return false;
    }
  }

  getServer(uuid) {
    if (this.servers[uuid] !== undefined) {
      return this.servers[uuid];
    }
    return null;
  }

  getServersAsList() {
    const list = [];
    for (const uuid of Object.keys(this.servers)) {
      list.push(this.servers[uuid]);
    }
    return list;
  }

  hasServer(uuid) {
    return this.servers[uuid] === undefined;
  }

  getServerStatus(uuid) {
    return this.servers[uuid].status;
  }

  getAllServersStatus() {
    const status = {};
    for (const server of this.getServersAsList()) {
      status[server.name] = this.getServerStatus(server.uuid);
    }
    return status;
  }
}

function saveConfig() {
  fs.writeFile('./config.json', JSON.stringify(config, null, 2), err => {
    if (err) console.error(err);
  });
}

function sendMessage(message) {
  if (config.channelID !== '') {
    const channel = client.channels.cache.get(config.channelID);
    if (channel !== undefined) {
      channel.send(message);
    }
  }
}

function vaildateArgsLength(commandName, args, length, channel, shouldSendMsg=true) {
  if (args.length !== length) {
    if (config.commands[commandName] !== undefined) {
      if (shouldSendMsg) {
        channel.send(config.commands[commandName].usage)
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
    config.channelID = channelID;
    saveConfig();
    msg.channel.send('News channel has been set to ' + arg);
  } else {
    msg.channel.send('Invalid channel');
  }
}

function untrackServer(msg, serverName) {
  if (serversHandler.untrackServer(serverName)) {
    msg.channel.send(serverName + ' has been removed from the tracking list');
  } else {
    msg.channel.send('Unable to find server with name ' + serverName);
  }
}

function listServersStatus(msg) {
  const serversStatus = serversHandler.getAllServersStatus();
  let list = 'Currently tracking:';
  for (const serverName of Object.keys(serversStatus)) {
    const status = (serversStatus[serverName] === 0) ? ' (Offline)' : ' (Online)';
    list += '\n' + serverName + status;
  }
  msg.channel.send(list);
}

async function stalk(msg, playerName, serverName=null) {
  const uuids = (serverName !== null) ? 
    serversHandler.getUUIDsFromName(serverName) : Object.keys(serversHandler.servers);
  let isOnline = false;
  if (uuids.length < 1) {
    msg.channel.send('Unknown server');
  }
  for (const uuid of uuids) {
    if (uuid !== null) {
      isOnline = await serversHandler.getServer(uuid).isPlayerOn(playerName);
      if (isOnline) {
        msg.channel.send(playerName + ' is currently on ' + serverList.servers[uuid].name);
        break;
      }
    }
  }
  if (!isOnline) {
    if(serverName !== null) {
      msg.channel.send(playerName + ' is not on any severs containing ' + serverName);
    } else {
      msg.channel.send(playerName + ' is not on any tracked severs');
    }
  }
}

function checkServerStatus(msg, serverName) {
  const uuids = serversHandler.getUUIDsFromName(serverName);
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
  const uuids = serversHandler.getUUIDsFromName(serverName);
  if (uuids.length > 0) {
    for (const uuid of uuids) {
      let str = '';
      if (serversHandler.getServerStatus(uuid) !== 0) {
        const server = serversHandler.getServer(uuid);
        str += '\nList of players on ' + server.name + ':';
        for (const player of (await server.getData()).players) {
          str += '\n' + player.name;
        }
        msg.channel.send(str.substring(1));
      } else {
        msg.channel.send(serverName + ' is offline');
      }
    }
  } else {
    msg.channel.send('Unknown Server');
  }
}

async function setupchannels(msg) {
  let category = msg.guild.channels.cache.find(c => c.name == 'Tracked Servers' && c.type == "category");
  if (!category) {
    category = await msg.guild.channels.create('Tracked Servers', {type: 'category'});
  }
  for (const serverUUID of Object.keys(serverList.servers)) {
    const server = serverList.servers[serverUUID];
    if (server.channelID === undefined) {
      try {
        const channel = await msg.guild.channels.create(server.name, {
          type: 'voice',
          parent: category.id,
          permissionOverwrites: [
            {
              id: msg.author.id,
              deny: ['CONNECT']
            }
          ]
        });
        const serverObj = serversHandler.getServer(serverUUID);
        serverList.servers[serverUUID].channelID = channel.id;
        channel.setName(getServerDisplayName(serverObj.name, serverObj.status));
      } catch(e) {
        console.error(e);
      }
    }
    serversHandler.saveServers();
  }
}

function getServerDisplayName(serverName, status) {
  const statusText = (status === 0) ? 'off' : 'on';
  const names = serverName.split('-');
  return names[names.length - 1].slice(-16) + ': ' + statusText
}

const serversHandler = new ServersHandler();

client.on('ready', () => {
  console.log('Logged in as ' + client.user.tag);
});

client.on('message', msg => {
  if (!msg.content.startsWith(config.prefix) 
    || msg.author.bot) return;
  const args = msg.content.slice(1).match(/"[^"]+"|[^\s]+/gm);
  for (let i = 0; i < args.length; i++) {
    args[i] = args[i].replaceAll('"', '');
  }
  const command = args.shift().toLowerCase();
  if (command === 'setchannel' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    setNotificationChannel(msg, args[0]);
  } else if (command === 'track' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 3, msg.channel)) return;
    serversHandler.trackServer(args[0], args[1], args[2], msg.guild);
    msg.channel.send(args[0] + ' has been added to the tracking list');
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
  } else if (command === 'listplayers') {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    listPlayers(msg, args[0]);
  } else if (command === 'setupchannels') {
    setupchannels(msg);
  }
});

client.login(config.token);