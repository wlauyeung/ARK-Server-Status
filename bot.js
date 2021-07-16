const Discord = require('discord.js');
const Gamedig = require('gamedig');
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler');
const fs = require('fs');
const config = require('./config.json');
const serverList = require('./servers.json');
const client = new Discord.Client();

class Server {
  constructor(name, id) {
    this.name = name;
    this.data = null;
    this.id = id;
    this.status = 0;
    this.offlineCounter = 0;
    this.update();
  }

  changeStatus(status) {
    if (this.status !== status) {
      switch (status) {
        case 1:
          sendMessage(this.name + ' is now online!');
          break;
        case 0:
          sendMessage(this.name + ' is now offline!');
          break;
        default:
          throw 'Unkown Status';
      }
      this.status = status;
    }
  }

  async update() {
    try {
      this.data = await Gamedig.query({
        type: 'arkse',
        host: serverList.servers[this.id].ip,
        port: serverList.servers[this.id].port
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
    if (this.data === null && this.status === 1) {
      this.update();
    }
    for (const player of this.data.players) {
      if (player.name === playerName) {
        return true;
      }
    }
    return false;
  }
}

class ServersHandler {
  constructor() {
    this.servers = [];
    const scheduler = new ToadScheduler();
    const task = new Task('update servers', (sh=this) => {sh.updateServers()});
    const job = new SimpleIntervalJob({ seconds: config.queryInterval}, task);

    for (let i = 0; i < serverList.servers.length; i++) {
      this.servers.push(new Server(serverList.servers[i].name, i));
    }
    scheduler.addSimpleIntervalJob(job);
  }

  saveServers() {
    fs.writeFile('./servers.json', JSON.stringify(serverList, null, 2), err => {
      if (err) console.error(err);
    });
  }

  async updateServers() {
    for (const server of this.servers) {
      server.update();
    }
  }

  getIdsFromName(serverName) {
    const list = [];
    for (const server of this.servers) {
      if (server.name.toLowerCase().includes(serverName.toLowerCase())) {
        list.push(server.id);
      }
    }
    return list;
  }

  trackServer(serverName, ip, port) {
    this.servers.push(new Server(serverName, this.servers.length));
    serverList.servers.push({name: serverName, ip: ip, port: port});
    this.saveServers();
  }

  trackServers(servers) {
    for (const server of this.servers) {
      this.trackServer(server.name, server.ip, server.port);
    }
  }

  untrackServer(serverName) {
    let index = -1;
    for (let i = 0; i < this.servers.length; i++) {
      if (this.servers[i].name === serverName) {
        index = i;
        break;
      }
    }
    if (index !== -1) {
      serverList.servers.splice(index, 1);
      this.servers.splice(index, 1);
      serversHandler.saveServers();
      return true;
    } else {
      return false;
    }
  }

  getServer(id) {
    if (this.servers[id] !== undefined) {
      return this.servers[id];
    }
    return null;
  }

  hasServer(id) {
    return this.servers[id] === undefined;
  }

  getServerStatus(id) {
    return this.servers[id].status;
  }

  getAllServersStatus() {
    const status = {};
    for (const server of this.servers) {
      status[server.name] = this.getServerStatus(server.id);
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

function vaildateArgsLength(commandName, args, length, channel) {
  if (args.length !== length) {
    if (config.commands[commandName] !== undefined) {
      channel.send(config.commands[commandName].usage)
    } else {
      console.error('Unable to find command \"' + commandName + "\"");
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

async function stalk(msg, serverName, playerName) {
  const ids = serversHandler.getIdsFromName(serverName);
  let isOnline = false;
  if (ids.length < 1) {
    msg.channel.send('Unknown server');
  }
  for (const id of ids) {
    if (id !== null) {
      isOnline = await serversHandler.getServer(id).isPlayerOn(playerName);
      if (isOnline) {
        msg.channel.send(playerName + ' is currently on ' + serverList.servers[id].name);
        break;
      }
    }
  }
  if (!isOnline) {
    msg.channel.send(playerName + ' is not on any severs containing ' + serverName);
  }
}

function checkServerStatus(msg, serverName) {
  const ids = serversHandler.getIdsFromName(serverName);
  if (ids.length === 0) {
    msg.channel.send('Unknown Server');
    return;
  }
  for (id of ids) {
    const status = (serversHandler.getServerStatus(id) === 0) ? 'offline' : 'online';
    found = true;
    msg.channel.send(serversHandler.getServer(id).name + ' is ' + status);
  }
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
    serversHandler.trackServer(args[0], args[1], args[2]);
    msg.channel.send(args[0] + ' has been added to the tracking list');
  } else if (command === 'untrack' && msg.member.hasPermission('ADMINISTRATOR')) {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    untrackServer(msg, args[0]);
  } else if (command === 'list') {
    listServersStatus(msg);
  } else if (command === 'stalk') {
    if (!vaildateArgsLength(command, args, 2, msg.channel)) return;
    stalk(msg, args[0], args[1]);
  } else if (command === 'status') {
    if (!vaildateArgsLength(command, args, 1, msg.channel)) return;
    checkServerStatus(msg, args[0]);
  }
});

client.login(config.token);