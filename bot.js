const Discord = require('discord.js');
const Gamedig = require('gamedig');
const { ToadScheduler, SimpleIntervalJob, Task } = require('toad-scheduler');
const fs = require('fs');
const config = require('./config.json');
const serverList = require('./servers.json');
const guildList = require('./guilds.json');
const credentials = require('./credentials.json')
const client = new Discord.Client();

class Server {
  #name
  #data
  #status
  #ip
  #port
  #offlineCounter

  constructor(name, ip, port) {
    this.#name = name;
    this.#data = null;
    this.#status = 0;
    this.#ip = ip;
    this.#port = port;
    this.#offlineCounter = 0;
  }

  get name() {
    return this.#name;
  }

  get status() {
    return this.#status;
  }

  getChannelDisplayName() {
    const statusText = (this.#status === 0 || this.#data === null) ? 'Off' :
      `${this.#data.raw.vanilla.players.length}/${this.#data.maxplayers}`;
    const names = this.#name.split('-');
    return names[names.length - 1].slice(-16) + ': ' + statusText;
  }

  #updateTracker(message = null) {
    for (const guildID of Object.keys(guildList.guilds)) {
      if (guildList.guilds[guildID].trackedServers[this.#name]) {
        const guild = client.guilds.cache.find((g => g.id === guildID));
        if (guild) {
          updateChannel(this.getChannelDisplayName(),
            guildList.guilds[guildID].trackedServers[this.#name].channelID)
            .catch(e => console.error(e));
          if (message) {
            sendMessage(message, guild.id);
          }
        }
      }
    }
  }

  #changeStatus(status, oldPlayerCount = 0) {
    if (this.#status !== status) {
      const statusText = (status === 0) ? 'offline' : 'online';
      this.#status = status;
      this.#updateTracker(`${this.#name} is now ${statusText}!`);
    } else if (status === 1 && oldPlayerCount !== this.#data.players.length) {
      this.#updateTracker();
    }
  }

  async update() {
    try {
      const oldPlayerCount = (this.#data === null) ? 0 : this.#data.players.length;
      this.#data = await Gamedig.query({
        type: 'minecraft',
        host: this.#ip,
        port: this.#port
      });
      this.#changeStatus(1, oldPlayerCount);
      this.#offlineCounter = 0;
    } catch (e) {
      this.#offlineCounter++;
      if (this.#offlineCounter > config.offlineCounterThreshold) {
        this.#changeStatus(0);
      }
    }
  }

  async isPlayerOn(playerName) {
    if (this.#status === 0 || await this.getData() === null) {
      return false;
    }
    for (const player of this.#data.raw.vanilla.players) {
      if (player.name === playerName) {
        return true;
      }
    }
    return false;
  }

  async getData() {
    if (this.#data === null) {
      await this.update();
    }
    return this.#data;
  }
}

class ServersHandler {
  #servers;

  constructor() {
    this.#servers = {};
    const scheduler = new ToadScheduler();
    const queryTask = new Task('update servers', (sh = this) => { sh.updateServers() });
    const queryJob = new SimpleIntervalJob({ seconds: config.queryInterval }, queryTask);

    for (const serverName of Object.keys(serverList.servers)) {
      const serverData = serverList.servers[serverName];
      if (serverData.tracked) {
        this.#servers[serverName] = new Server(serverName, serverData.ip, serverData.port);
      }
    }

    scheduler.addSimpleIntervalJob(queryJob);
  }

  saveServers() {
    fs.writeFile('./servers.json', JSON.stringify(serverList, null, 2), err => {
      if (err) console.error(err);
    });
  }

  async updateServers() {
    Object.keys(this.#servers).forEach(sName => this.#servers[sName].update());
  }

  getNamesFromStr(string, tracked = false, guildID = '') {
    if (tracked && guildID === '') {
      throw 'empty guild id';
    }
    const list = [];
    const servers = (tracked) ? this.getTrackedServerNamesAsList(guildID) : Object.keys(serverList.servers);
    for (const server of servers) {
      if (server.toLowerCase().includes(string.toLowerCase())) {
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
      this.#servers[serverName] = new Server(serverName, serverData.ip, serverData.port);
      this.saveServers();
      return true;
    }
    return false;
  }

  untrackServer(serverName) {
    if (this.#servers[serverName] !== undefined) {
      serverList.servers[serverName].tracked = false;
      delete this.#servers[serverName];
      this.saveServers();
      return true;
    }
    return false;
  }

  getServer(serverName) {
    if (this.#servers[serverName] !== undefined) {
      return this.#servers[serverName];
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

  hasServer(serverName) {
    return this.#servers[serverName] === undefined;
  }

  getServerStatus(serverName) {
    return this.#servers[serverName].status;
  }

  getAllTrackedServersStatus(guildID) {
    const status = {};
    for (const server of this.getTrackedServerNamesAsList(guildID)) {
      status[server.name] = this.getServerStatus(server.name);
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

  run(commandName, args, msg) {
    if (this.commands[commandName] !== undefined) {
      const command = this.commands[commandName];
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
          reply += `\n${config.prefix}${commandName} ${usage}`;
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

async function updateChannel(name, channelID) {
  try {
    if (channelID !== undefined) {
      const channel = client.channels.cache.get(channelID);
      if (channel !== undefined) {
        channel.setName(name);
        return channel;
      }
      throw Error(`channel ${channelID} not found`);
    }
  } catch (e) {
    throw e;
  }
}

async function createChannel(guild, name) {
  try {
    let category = guild.channels.cache.find(c => c.name === 'Tracked Servers' && c.type === "category");
    if (!category) {
      category = await guild.channels.create('Tracked Servers', { type: 'category' });
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
  } catch (e) {
    throw e;
  }
}

async function deleteChannel(channelID) {
  try {
    const channel = client.channels.cache.find(c => c.id === channelID);
    if (channel) {
      await channel.delete();
    }
  } catch (e) {
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
  let serverNames = serversHandler.getNamesFromStr(serverName, false);
  if (serverNames.length > 1 && serverNames.length < 20) {
    let foundExactName = false;
    for (const serverName of serverNames) {
      if (serverName === serverName) {
        foundExactName = true;
        serverNames = [serverName];
      }
    }
    if (!foundExactName) {
      let reply = 'Did you mean:'
      for (const serverName of serverNames) {
        reply += `\n${serverName}`;
      }
      msg.channel.send(reply);
      return;
    }
  } else if (serverNames.length > 20) {
    msg.channel.send('Please be more specific');
    return;
  }
  if (serverNames.length === 1) {
    if (guildList.guilds[msg.guild.id]) {
      if (guildList.guilds[msg.guild.id].trackedServers[serverNames[0]] === undefined) {
        if (!serverList.servers[serverNames[0]].tracked) {
          serversHandler.trackServer(serverNames[0]);
        }
        guildList.guilds[msg.guild.id].trackedServers[serverNames[0]] = {
          channelID: (await createChannel(msg.guild,
            serversHandler.getServer(serverNames[0]).getChannelDisplayName())).id,
          muted: config.defaultMute
        };
        saveGuild();
        msg.channel.send(serverNames[0] + ' has been added to the tracking list');
      } else {
        msg.channel.send(serverNames[0] + ' is already on the tracking list');
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
  const serverNames = serversHandler.getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length > 1 && serverNames.length < 20) {
    let reply = 'Did you mean:'
    for (const serverName of serverNames) {
      reply += `\n${serverName}`;
    }
    msg.channel.send(reply);
  } else if (serverNames.length > 20) {
    msg.channel.send('Please be more specific');
  } else if (serverNames.length === 1) {
    if (guildList.guilds[msg.guild.id]) {
      if (guildList.guilds[msg.guild.id].trackedServers[serverNames[0]] !== undefined) {
        let isTrackedOnElseWhere = false;
        for (const guildID of Object.keys(guildList.guilds)) {
          if (guildList.guilds[guildID].trackedServers[serverNames[0]] !== undefined && guildID !== msg.guild.id) {
            isTrackedOnElseWhere = true;
            break;
          }
        }
        if (!isTrackedOnElseWhere) {
          serversHandler.untrackServer(serverNames[0]);
        }
        deleteChannel(guildList.guilds[msg.guild.id].trackedServers[serverNames[0]].channelID);
        delete guildList.guilds[msg.guild.id].trackedServers[serverNames[0]];
        saveGuild();
        msg.channel.send(serverNames[0] + ' has been removed from the tracking list');
      } else {
        msg.channel.send(serverNames[0] + ' is not tracked');
      }
    } else {
      console.error('guild id not found');
    }
  } else {
    msg.channel.send('Unable to find server with name ' + serverName);
  }
}

commandFunctions['stalk'] = async (args, msg) => {
  let serverName = null;
  let playerName = args[0];

  if (args[1] !== undefined) {
    serverName = args[0];
    playerName = args[1];
  }

  const serverNames = (serverName !== null) ?
    serversHandler.getNamesFromStr(serverName, true, msg.guild.id) :
    serversHandler.getTrackedServerNamesAsList(msg.guild.id);
  if (serverName === null && serverNames.length === 0) {
    msg.channel.send('Not tracking any server')
    return;
  }
  let isOnline = false;
  if (serverNames.length < 1) {
    msg.channel.send('Unknown server');
    return;
  }
  for (const sName of serverNames) {
    if (sName !== null) {
      isOnline = await serversHandler.getServer(sName).isPlayerOn(playerName);
      if (isOnline) {
        msg.channel.send(playerName + ' is currently on ' + serversHandler.getServer(sName).name);
        break;
      }
    }
  }
  if (!isOnline) {
    if (serverName !== null) {
      msg.channel.send(playerName + ' is not on any severs containing ' + serverName);
    } else {
      msg.channel.send(playerName + ' is not on any tracked servers');
    }
  }
}

commandFunctions['status'] = (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler.getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length === 0) {
    msg.channel.send('Unknown Server');
    return;
  }
  for (const serverName of serverNames) {
    const status = (serversHandler.getServerStatus(serverName) === 0) ? 'offline' : 'online';
    found = true;
    msg.channel.send(serversHandler.getServer(serverName).name + ' is currently ' + status);
  }
}

commandFunctions['listplayers'] = async (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler.getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length > 0) {
    for (const sName of serverNames) {
      let str = '';
      const server = serversHandler.getServer(sName);
      if (server.status === 1) {
        str += '\nList of players on ' + server.name + ':';
        for (const player of (await server.getData()).raw.vanilla.players) {
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
    const serverNames = serversHandler.getNamesFromStr(serverName, true, msg.guild.id);
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
    const serverNames = serversHandler.getNamesFromStr(serverName, true, msg.guild.id);
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

client.login(credentials.token);