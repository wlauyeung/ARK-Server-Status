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

  updateChannel(message = null) {
    for (const guildID of Object.keys(guildList.guilds)) {
      if (guildList.guilds[guildID].trackedServers[this.name]) {
        const guild = client.guilds.cache.find((g => g.id === guildID));
        if (guild) {
          updateChannel(this.getChannelDisplayName(), 
          guildList.guilds[guildID].trackedServers[this.name])
          .catch(e => console.error(e));
          if (message) {
            sendMessage(message, guild.id);
          }
        }
      }
    }
  }

  changeStatus(status) {
    if (this.status !== status) {
      const statusText = (status === 0) ? 'offline' : 'online';
      this.status = status;
      this.updateChannel(`${this.name} is now ${statusText}!`);
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
    if (this.status === 0 || await this.getData() === null) {
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

  getUUIDsFromName(serverName, tracked = false, guildID='') {
    if (tracked && guildID === '') {
      throw 'empty guild id';
    }
    const list = [];
    const servers = (tracked) ? this.getTrackedServerNamesAsList(guildID) : Object.keys(serverList.servers);
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

  getServerNamesAsList() {
    return Object.keys(serverList.servers);
  }

  getTrackedServerNamesAsList(guildID) {
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
    for (const server of this.getTrackedServerNamesAsList(guildID)) {
      status[server.name] = this.getServerStatus(server.uuid);
    }
    return status;
  }
}

class CommandsHandler {
  constructor() {
    this.commands = {};
  }

  addCommand(name, settings, func) {
    this.commands[name] = {
      settings: settings,
      func: func
    };
  }

  run(name, args, msg) {
    if (this.commands[name] !== undefined) {
      const command = this.commands[name];
      let argslengs = command.settings.usage.map(usage => usage.split(' ').length);
      argslengs = (argslengs.length === 0) ? [0] : argslengs;
      if (command.settings.admin && !msg.member.hasPermission('ADMINISTRATOR')) {
        return;
      }
      if (argslengs.includes(args.length)) {
        command.func(args, msg);
      } else {
        let reply = 'Invalid command! Usage:';
        for (const usage of command.settings.usage) {
          reply += `\n${config.prefix}${name} ${usage}`;
        }
        msg.channel.send(reply);
      }
    }
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

async function stalk(msg, playerName, serverName=null) {
  const uuids = (serverName !== null) ? 
    serversHandler.getUUIDsFromName(serverName, true, msg.guild.id) : 
    serversHandler.getTrackedServerNamesAsList(msg.guild.id);
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

const serversHandler = new ServersHandler();
const commandHandler = new CommandsHandler();
const commandFunctions = {};

commandFunctions['setchannel'] = (args, msg) => {
  const arg = args[0];
  const channelID = arg.replace('<', '').replace('>', '').replace('#', '');
  if (client.channels.cache.get(channelID) !== undefined) {
    guildList.guilds[msg.guild.id].channelID = channelID;
    saveGuild();
    msg.channel.send('News channel has been set to ' + arg);
  } else {
    msg.channel.send('Invalid channel');
  }
};

commandFunctions['track'] = async (args, msg) => {
  const serverName = args[0];
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
      if (guildList.guilds[msg.guild.id].trackedServers[uuids[0]] === undefined) {
        if (!serverList.servers[uuids[0]].tracked) {
          serversHandler.trackServer(uuids[0]);
        }
        guildList.guilds[msg.guild.id].trackedServers[uuids[0]] = {
          channelID: (await createChannel(msg.guild, 
          serversHandler.getServer(uuids[0]).getChannelDisplayName())).id,
          muted: config.defaultMute
        };
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

commandFunctions['untrack'] = (args, msg) => {
  const serverName = args[0];
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
      if (guildList.guilds[msg.guild.id].trackedServers[uuids[0]] !== undefined) {
        let isTrackedOnElseWhere = false;
        for (const guildID of Object.keys(guildList.guilds)) {
          if (guildList.guilds[guildID].trackedServers[uuids[0]] !== undefined && guildID !== msg.guild.id) {
            isTrackedOnElseWhere = true;
            break;
          }
        }
        if(!isTrackedOnElseWhere) {
          serversHandler.untrackServer(uuids[0]);
        }
        deleteChannel(guildList.guilds[msg.guild.id].trackedServers[uuids[0]].channelID);
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

commandFunctions['stalk'] = (args, msg) => {
  if (args.length === 1) {
    stalk(msg, args[0]);
  } else {
    stalk(msg, args[1], args[0]);
  }
}

commandFunctions['status'] = (args, msg) => {
  const serverName = args[0];
  const uuids = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
  if (uuids.length === 0) {
    msg.channel.send('Unknown Server');
    return;
  }
  for (const uuid of uuids) {
    const status = (serversHandler.getServerStatus(uuid) === 0) ? 'offline' : 'online';
    found = true;
    msg.channel.send(serversHandler.getServer(uuid).name + ' is ' + status);
  }
}

commandFunctions['listplayers'] = async (args, msg) => {
  const serverName = args[0];
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

commandFunctions['rates'] = async (args, msg) => {
  try {
    const res = await axios.get('http://arkdedicated.com/dynamicconfig.ini');
    msg.channel.send(res.data);
  } catch(e) {
    msg.channel.send('Unable to fetch data');
  }
}

commandFunctions['mute'] = (args, msg) => {
  const serverName = args[0];
  if (serverName === 'all') {
    Object.keys(guildList.guilds[msg.guild.id].trackedServers).forEach((sn) => {
      if (!guildList.guilds[msg.guild.id].trackedServers[sn].muted) {
        guildList.guilds[msg.guild.id].trackedServers[sn].muted = true;
      }
    });
    saveGuild();
    msg.channel.send(`Successfully muted all servers`);
  } else {
    const serverNames = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
    if (serverNames.length === 1) {
      const server = serversHandler.getServer(serverNames[0]);
      if (!guildList.guilds[msg.guild.id].trackedServers[server.name].muted) {
        guildList.guilds[msg.guild.id].trackedServers[server.name].muted = true;
        saveGuild();
      }
      msg.channel.send(`Successfully muted ${server.name}`);
    } else if (serverNames.length > 1) {
      msg.channel.send('Please be more specific');
    } else {
      msg.channel.send('Unknown Server');
    }
  }
}

commandFunctions['unmute'] = (args, msg) => {
  const serverName = args[0];
  if (serverName === 'all') {
    Object.keys(guildList.guilds[msg.guild.id].trackedServers).forEach((sn) => {
      if (guildList.guilds[msg.guild.id].trackedServers[sn].muted) {
        guildList.guilds[msg.guild.id].trackedServers[sn].muted = false;
      }
    });
    saveGuild();
    msg.channel.send(`Successfully unmuted all servers`);
  } else {
    const serverNames = serversHandler.getUUIDsFromName(serverName, true, msg.guild.id);
    if (serverNames.length === 1) {
      const server = serversHandler.getServer(serverNames[0]);
      if (guildList.guilds[msg.guild.id].trackedServers[server.name].muted) {
        guildList.guilds[msg.guild.id].trackedServers[server.name].muted = false;
        saveGuild();
      }
      msg.channel.send(`Successfully unmuted ${server.name}`);
    } else if (serverNames.length > 1) {
      msg.channel.send('Please be more specific');
    } else {
      msg.channel.send('Unknown Server');
    }
  }
}

for (const commandName of Object.keys(config.commands)) {
  const commandConfig = config.commands[commandName];
  for (const alias of commandConfig.alias) {
    commandHandler.addCommand(alias, commandConfig, commandFunctions[commandName]);
  }
}

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
  commandHandler.run(command, args, msg);
});

client.login(config.token);