const {Client, Intents} = require('discord.js');
const Gamedig = require('gamedig');
const {ToadScheduler, SimpleIntervalJob, Task} = require('toad-scheduler');
const fs = require('fs');
const config = require('./config.json');
const serverList = require('./servers.json');
const guildList = require('./guilds.json');
const credentials = require('./credentials.json');
const messages = require('./messages.json');
const client = new Client({
  intents: [
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILDS,
  ],
});
const axios = require('axios').default;

/**
 * A class that handles all guild operations.
 */
class GuildsHandler {
  /**
   * Returns true if a guild with guildID exists and
   * false otherwise.
   * @param {String} guildID The ID of the guild.
   * @return {boolean} True if exists false otherwise.
   */
  static hasGuild(guildID) {
    return (guildList.guilds[guildID] !== undefined);
  }

  /**
   * Returns the guild with guildID if it exists.
   * @param {String} guildID The ID of the guild.
   * @return {Object} The infomation about a guild
   * if it exists and undefined if it doesn't.
   */
  static getGuild(guildID) {
    return guildList.guilds[guildID];
  }

  /**
   * Adds a guild.
   * @param {String} guildID The ID of the guild.
   * @param {String} channelID The ID of the news channel.
   */
  static async addGuild(guildID, channelID) {
    guildList.guilds[guildID] = {
      channelID: channelID,
      trackedServers: {},
    };
    return (await this.#saveGuild());
  }

  /**
   * Gets the list of all registered guild IDs.
   * @return {String[]} The list of all registered guild IDs.
   */
  static getGuildIDs() {
    return Object.keys(guildList.guilds);
  }

  /**
   * Updates the news channel ID to channel ID in guild with
   * ID guildID.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {Stirng} guildID The ID of the guild.
   * @param {String} channelID The ID of the channel.
   * @return {boolean} True if successful and false otherwise.
   */
  static async updateGuildChannelID(guildID, channelID) {
    guildList.guilds[guildID].channelID = channelID;
    return (await this.#saveGuild());
  }

  /**
   * Updates A tracked server's data in a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @param {String} serverName The name of the tracked server.
   * @param {String} channelID (OPTIONAL) The channel ID to be updated.
   * @param {boolean} muted  (OPTIONAL) The muted status to be updated.
   * @return {boolean} True if successful and false otherwise.
   */
  static async updateGuildTrackedServerInfo(guildID, serverName,
      channelID, muted) {
    if (channelID === undefined && muted === undefined) {
      return true;
    }
    const trackedServer = guildList.guilds[guildID].trackedServers[serverName];
    if (trackedServer === undefined) {
      return false;
    }
    if (channelID !== undefined) {
      trackedServer.channelID = channelID;
    }
    if (muted !== undefined) {
      trackedServer.muted = muted;
    }
    return (await this.#saveGuild());
  }

  /**
   * Adds a tracked server to a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @param {String} serverName The tracked server's name.
   * @param {String} channelID The channel ID of the server's
   * tracker.
   * @return {boolean} True if successful and false otherwise.
   */
  static async addGuildTrackedServer(guildID, serverName, channelID) {
    guildList.guilds[guildID].trackedServers[serverName] = {
      channelID: channelID,
      muted: config.defaultMute,
    };
    return (await this.#saveGuild());
  }

  /**
   * Removes a tracked server from a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @param {String} serverName The tracked server's name.
   * @return {boolean} True if successful and false otherwise.
   */
  static async removeGuildTrackedServer(guildID, serverName) {
    delete guildList.guilds[guildID].trackedServers[serverName];
    return (await this.#saveGuild());
  }

  /**
   * Mutes a tracked server form a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @param {String} serverName The tracked server's name.
   * @param {boolean} muted The new status.
   * @param {boolean} save (OPTIONAL) Hard save or not.
   * @return {boolean} True if successful and false otherwise.
   */
  static async setTrackedServerMuteStatus(guildID, serverName, muted,
      save = true) {
    const trackedServer = guildList.guilds[guildID].trackedServers[serverName];
    if (trackedServer === undefined) {
      return false;
    }
    if (trackedServer.muted !== muted) {
      trackedServer.muted = muted;
      if (save) {
        return (await this.#saveGuild());
      }
    }
    return true;
  }

  /**
   * Mutes all the tracked servers of a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @param {boolean} muted The new status.
   * @return {boolean} True if successful and false otherwise.
   */
  static async setAllTrackedServersMuteStatus(guildID, muted) {
    const serverNames = this.getAllTrackedServerNames(guildID);
    for (const serverName of serverNames) {
      this.setTrackedServerMuteStatus(guildID, serverName, muted, false);
    }
    return (await this.#saveGuild());
  }

  /**
   * Gets the names of all tracked servers of a guild.
   * Caller should make sure guildID maps to an existing guild.
   * (See GuildHandler.hasGuild())
   * @param {String} guildID The ID of the guild.
   * @return {String[]} A list of server names.
   */
  static getAllTrackedServerNames(guildID) {
    return Object.keys(guildList.guilds[guildID].trackedServers);
  }

  /**
   * Saves the current guild data to ./guilds.json
   * @return {Promise} Returns true if successful and false otherwise.
   */
  static #saveGuild() {
    return new Promise((resolve, reject) => {
      fs.writeFile('./guilds.json',
          JSON.stringify(guildList, null, 2), (err) => {
            if (err) {
              resolve(false);
            } else {
              resolve(true);
            }
          });
    });
  }
};

/**
 * The server class
 */
class Server {
  #name;
  #data;
  #status;
  #ip;
  #port;
  #offlineCounter;
  #isTrackerSynced;
  #upticks;
  #downtics;

  /**
   * Adds two numbers together.
   * @param {String} name A unique name for this server.
   * @param {String} ip The IP address of this server.
   * @param {int} port The port of this sevrer.
   */
  constructor(name, ip, port) {
    this.#name = name;
    this.#data = null;
    this.#status = 0;
    this.#ip = ip;
    this.#port = port;
    this.#offlineCounter = 0;
    this.#isTrackerSynced = true;
    this.#upticks = 0;
    this.#downtics = 0;
  }

  /**
   * Returns the server's name.
   * @return {String} This server's name.
   */
  get name() {
    return this.#name;
  }

  /**
   * Returns the server's status.
   * @return {int} The server's status; 0 is off, 1 is on
   */
  get status() {
    return this.#status;
  }

  /**
   * Returns the the display name for this server.
   * @return {String} The display name printed on a discord channel.
   */
  getChannelDisplayName() {
    const statusText = (this.#status === 0 || this.#data === null) ?
      messages.server.tracker.offline :
      messages.server.tracker.online;
    const names = this.#name.split('-');
    return names[names.length - 1].slice(-16) + ': ' + statusText;
  }

  /**
   * Updates this server's discord channel display name.
   * @param {String} message A message that will be displayed when the tracker
   * is updated.
   */
  #updateTracker(message = null) {
    for (const guildID of GuildsHandler.getGuildIDs()) {
      const guildInfo = GuildsHandler.getGuild(guildID);
      if (guildInfo.trackedServers[this.#name]) {
        const guild = client.guilds.cache.find(((g) => g.id === guildID));
        if (guild) {
          try {
            updateChannel(this.getChannelDisplayName(),
                guildInfo.trackedServers[this.#name].channelID);
            this.#isTrackerSynced = true;
          } catch (e) {
            this.#isTrackerSynced = false;
          }
          if (message &&
             !guildInfo.trackedServers[this.#name].muted) {
            sendMessage(message, guildID);
          }
        }
      }
    }
  }

  /**
   * Updates the status of this server.
   * @param {int} status New status.
   * @param {int} oldPlayerCount The previous player count.
   */
  #changeStatus(status) {
    if (this.#status !== status) {
      this.#status = status;
      const statusText = (this.#status === 0) ? messages.server.offline :
          messages.server.online;
      this.#updateTracker(messages.actions.onStatusChange
          .replace('$SERVER_NAME', this.#name)
          .replace('$STATUS', statusText));
    } else if (!this.#isTrackerSynced) {
      this.#updateTracker();
    }
  }

  /**
   * Queries new data about this server.
   */
  async update() {
    try {
      this.#data = await Gamedig.query({
        type: 'arkse',
        host: this.#ip,
        port: this.#port,
      });
    } catch (e) {
      this.#offlineCounter++;
      this.#downtics++;
      this.#data = null;
      if (this.#offlineCounter === config.offlineCounterThreshold) {
        this.#changeStatus(0);
      }
      return;
    }
    this.#changeStatus(1);
    this.#offlineCounter = 0;
    this.#upticks++;
  }

  /**
   * Returns true if a player is on this server
   * and false otherwise.
   * @param {String} playerName The player's name.
   * @return {boolean} True is the player's on and false otherwise.
   */
  async isPlayerOn(playerName) {
    if (this.#status === 0 || await this.getData() === null) {
      return false;
    }
    for (const player of this.getPlayersList()) {
      if (player.name === playerName) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns the data of this server.
   * @return {Object} The data of this server.
   */
  async getData() {
    if (this.#data === null) {
      await this.update();
    }
    return this.#data;
  }

  /**
   * Get the list of all online players.
   * @return {String[]} A list containing all online players.
   */
  getPlayersList() {
    return (this.#data === null || this.#data.players === undefined) ?
        [] : this.#data.players;
  }

  /**
   * Get the maxinum number of players.
   * @return {int} The threshold of online players for this server.
   */
  getMaxPlayers() {
    return (this.#data === null) ? 0 : this.#data.maxplayers;
  }

  /**
   * Get the uptime percentage of this server.
   * @return {Number} Uptime percentage.
   */
  getUpTimePercentage() {
    if (this.#upticks + this.#downtics === 0) return 0;
    return (this.#upticks / (this.#upticks + this.#downtics)).toFixed(4);
  }
}

/**
 * A class that updates the server list.
 */
class OfficialServersUpdater {
  static #ports = [27015, 27017, 27019, 27021];
  #progress;
  #serversHandler;

  /**
   * Initiate this object.
   * @param {ServersHandler} serversHandler The ServerHandler.
   */
  constructor(serversHandler) {
    this.#progress = 0;
    this.#serversHandler = serversHandler;
  }

  /**
   * Sleep for ms milliseconds.
   * @param {int} ms Milliseconds.
   * @return {Promise} A promise.
   */
  #sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Queries data for a server.
   * @param {String} serverIP A server's IP address.
   * @param {int} port A server's port.
   * @return {Promise} A promise.
   */
  queryServer(serverIP, port) {
    return new Promise((resolve) => {
      Gamedig.query({
        type: 'arkse',
        host: serverIP,
        port: port,
      }).then((state) => {
        const name = state.name.replace(/\s-\s\(.+\)/gm, '');
        if (name !== null) {
          serverList.servers[name] = {
            ip: serverIP,
            port: port,
            tracked: false,
          };
          this.#progress++;
        }
      }).catch((e) => {
        this.#progress++;
      });
      resolve(1);
    });
  }

  /**
   * Runs query process.
   */
  async run() {
    try {
      const res = await axios.get('http://arkdedicated.com/officialservers.ini');
      const arkServers = res.data.match(/(?:[0-9]{1,3}\.){3}[0-9]{1,3}/gm);
      const numServers = arkServers.length *
      OfficialServersUpdater.#ports.length;

      console.log('Updating all official servers');
      for (const serverIP of arkServers) {
        for (const port of OfficialServersUpdater.#ports) {
          this.queryServer(serverIP, port);
          await this.#sleep(1);
        }
      }
      while (this.#progress !== numServers) {
        console.log(`Progress: ${this.#progress}/${numServers}`);
        await this.#sleep(1000);
      }
      for (const serverName of Object.keys(this.#serversHandler.getServers())) {
        const server = this.#serversHandler.getServer(serverName);
        serverList.servers[server.name].tracked = true;
        server.ip = serverList.servers[server.name].ip;
        server.port = serverList.servers[server.name].port;
        server.update();
      }
      this.#serversHandler.saveServers();
      this.#progress = 0;
      console.log(`Update completed!`);
    } catch (e) {
      throw e;
    }
  }
}

/**
 * A class that handle tracking and untracking servers and provides
 * utilities to help monitoring all servers.
 */
class ServersHandler {
  #servers;

  /**
   * Setup schedulers and everything.
   */
  constructor() {
    this.#servers = {};
    this.serversUpdater = new OfficialServersUpdater(this);
    const scheduler = new ToadScheduler();
    const queryTask = new Task('update servers',
        (sh = this) => {
          sh.updateServers();
        });
    const queryJob = new SimpleIntervalJob({
      seconds: config.queryInterval,
    }, queryTask);
    const updateTask = new Task('update server lists',
        (su=this.serversUpdater) => {
          su.run();
        });
    const updateJob = new SimpleIntervalJob(
        {days: config.serverListUpdateInterval}, updateTask);

    for (const serverName of Object.keys(serverList.servers)) {
      const serverData = serverList.servers[serverName];
      if (serverData.tracked) {
        this.#servers[serverName] = new Server(serverName,
            serverData.ip, serverData.port);
      }
    }

    scheduler.addSimpleIntervalJob(queryJob);
    scheduler.addSimpleIntervalJob(updateJob);

    this.serversUpdater.run();
  }

  /**
   * Saves the current server list to ./servers.json.
   */
  saveServers() {
    fs.writeFile('./servers.json', JSON.stringify(serverList, null, 2),
        (err) => {
          if (err) console.error(err);
        });
  }

  /**
   * Updates all servers in this.#servers.
   */
  async updateServers() {
    Object.keys(this.#servers).forEach((sName) =>
      this.#servers[sName].update());
  }

  /**
   * Finds all the server names with string.
   * @param {String} string The string that the servers include.
   * @param {boolean} tracked Should it find tracked server only.
   * @param {String} guildID The guild ID of the Discord server.
   * @return {String[]} All the server names with string included.
   */
  getNamesFromStr(string, tracked = false, guildID = '') {
    if (tracked && guildID === '') {
      throw Error('empty guild id');
    }
    const list = [];
    const servers = (tracked) ? this.getTrackedServerNamesAsList(guildID):
    Object.keys(serverList.servers);
    for (const server of servers) {
      if (server.toLowerCase().includes(string.toLowerCase())) {
        list.push(server);
      }
    }
    return list;
  }

  /**
   * Track a server with name serverName.
   * @param {String} serverName The name of the server.
   * @return {boolean} True if successful and false otherwise.
   */
  trackServer(serverName) {
    const serverData = serverList.servers[serverName];
    if (serverData !== undefined &&
      !serverData.tracked) {
      serverData.tracked = true;
      this.#servers[serverName] = new Server(serverName,
          serverData.ip, serverData.port);
      this.saveServers();
      return true;
    }
    return false;
  }

  /**
   * Untrack a server with name serverName.
   * @param {String} serverName The serverName of the server.
   * @return {boolean} True if succesfull and falses otherise.
   */
  untrackServer(serverName) {
    if (this.#servers[serverName] !== undefined) {
      serverList.servers[serverName].tracked = false;
      delete this.#servers[serverName];
      this.saveServers();
      return true;
    }
    return false;
  }

  /**
   * The the server object named serverName
   * in this.#servers.
   * @param {String} serverName The unique name of the server.
   * @return {Server} A Server if found and null if nothing found.
   */
  getServer(serverName) {
    if (this.#servers[serverName] !== undefined) {
      return this.#servers[serverName];
    }
    return null;
  }

  /**
   * Returns the list of servers that this handler is tracking.
   * @return {Server[]} The list containing all tracked servers in this handler.
   */
  getServers() {
    return this.#servers;
  }

  /**
   * Returns all the server names in serverList.
   * @return {String[]} A list of server names.
   */
  getServerNamesAsList() {
    return Object.keys(serverList.servers);
  }

  /**
   * Returns all tracked server names.
   * @param {String} guildID The guild ID of a Discord server.
   * @return {String[]} A list of server names.
   */
  getTrackedServerNamesAsList(guildID) {
    if (!guildID || guildID === '') {
      throw Error(messages.errors.invalidGuildID);
    }
    return GuildsHandler.getAllTrackedServerNames(guildID);
  }

  /**
   * Returns true if a sever with name serverName is being tracked
   * and false otherwise.
   * @param {String} serverName The name of the sever.
   * @return {boolean} True if there's a server with name serverName being
   * tracked and false otherwise.
   */
  hasServer(serverName) {
    return this.#servers[serverName] === undefined;
  }

  /**
   * Returns the status of a server with name serverName.
   * @param {String} serverName The name of the server.
   * @return {int} 1 if online, 0 if offline, undefined if
   * no server named serverName.
   */
  getServerStatus(serverName) {
    return this.#servers[serverName].status;
  }

  /**
   * Return a directory of statuses with a server's name as the key.
   * @param {String} guildID The guild ID of a Discord server.
   * @return {Object} A directory of statuses with a server's name as the key.
   */
  getAllTrackedServersStatus(guildID) {
    const status = {};
    for (const server of this.getTrackedServerNamesAsList(guildID)) {
      status[server.name] = this.getServerStatus(server.name);
    }
    return status;
  }
}

/**
 * A class that handles commands.
 */
class CommandsHandler {
  /**
   * Initiate the list of commands.
   */
  constructor() {
    this.commands = {};
  }

  /**
   * Register a new command.
   * @param {String} name The name of the command.
   * @param {Object} settings The settings of the command. Look at config.json
   * for more information about what should be in this object.
   * @param {Function} func The callback function of this command.
   */
  addCommand(name, settings, func) {
    this.commands[name] = {
      settings: settings,
      func: func,
    };
  }

  /**
   * Executes a command with name commandName.
   * @param {String} commandName The name of the command.
   * @param {String} args The arguments of the command.
   * @param {Discord.Message} msg The message object.
   * @return {void}
   */
  run(commandName, args, msg) {
    if (this.commands[commandName] !== undefined) {
      const command = this.commands[commandName];
      let argslengs = command.settings.usage.map((usage) =>
        usage.split(' ').length);
      argslengs = (argslengs.length === 0) ? [0] : argslengs;
      if (command.settings.admin &&
        !msg.member.permissions.has('ADMINISTRATOR')) {
        return;
      }
      if (argslengs.includes(args.length)) {
        command.func(args, msg);
      } else {
        let reply = messages.errors.invalidCommand;
        for (const usage of command.settings.usage) {
          reply += `\n${config.prefix} ${commandName} ${usage}`;
        }
        msg.channel.send(reply);
      }
    } else {
      msg.channel.send(messages.errors.invalidCommand);
    }
  }
}

/**
 * Sends a message message to the Discord server with guild id guilID.
 * @param {String} message The message.
 * @param {String} guildID The guild ID of a Discord server.
 */
function sendMessage(message, guildID) {
  if (GuildsHandler.hasGuild(guildID)) {
    const guildInfo = GuildsHandler.getGuild(guildID);
    const channelID = guildInfo.channelID;
    if (channelID !== '') {
      const channel = client.channels.cache.get(channelID);
      if (channel !== undefined) {
        channel.send(message);
      }
    }
  }
}

/**
 * Updates a Discord channel with text name.
 * @param {String} name The new name of the channel.
 * @param {String} channelID The channel ID of the channel.
 * @return {Discord.Channel} The channel.
 */
async function updateChannel(name, channelID) {
  try {
    if (channelID !== undefined) {
      const channel = client.channels.cache.get(channelID);
      if (channel !== undefined) {
        channel.setName(name);
        return channel;
      }
      throw Error(messages.errors.invalidChannelID
          .replace('$CHANNEL_ID', channelID));
    }
  } catch (e) {
    throw e;
  }
}

/**
 * Creates a Discord channel with name name
 * in a Discord server with guild guild.
 * @param {Discord.Guild} guild The Discord server.
 * @param {String} name The new channel's name.
 * @return {Discord.Channel} The new channel.
 */
async function createChannel(guild, name) {
  try {
    let category = guild.channels.cache.find((c) =>
      c.name === messages.trackedServerCategoryName &&
      c.type === 'GUILD_CATEGORY');
    if (!category) {
      category = await guild.channels
          .create(messages.trackedServerCategoryName, {type: 'GUILD_CATEGORY'});
    }
    const everyoneRoleID = guild.roles.everyone.id;
    const channel = await guild.channels.create(name, {
      type: 'GUILD_VOICE',
      parent: category.id,
      permissionOverwrites: [
        {
          id: everyoneRoleID,
          deny: ['CONNECT'],
        },
      ],
    });
    return channel;
  } catch (e) {
    throw e;
  }
}

/**
 * Deletes an existing channel with ID channelID.
 * @param {String} channelID The ID of the channel to be deleted.
 */
async function deleteChannel(channelID) {
  try {
    const channel = client.channels.cache.find((c) => c.id === channelID);
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
    GuildsHandler.updateGuildChannelID(msg.guild.id, channelID);
    msg.channel.send(
        messages.actions.onNewsChannelChange.success.replace('$CHANNEL_NAME',
            arg));
  } else {
    msg.channel.send(messages.actions.onNewsChannelChange.failure);
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
      let reply = messages.actions.onServerSearch.suggest;
      for (const serverName of serverNames) {
        reply += `\n${serverName}`;
      }
      msg.channel.send(reply);
      return;
    }
  } else if (serverNames.length > 20) {
    msg.channel.send(messages.actions.onServerSearch.needInfo);
    return;
  }
  if (serverNames.length === 1) {
    if (GuildsHandler.hasGuild(msg.guild.id)) {
      const guildInfo = GuildsHandler.getGuild(msg.guild.id);
      if (guildInfo.trackedServers[serverNames[0]] === undefined) {
        if (!serverList.servers[serverNames[0]].tracked) {
          serversHandler.trackServer(serverNames[0]);
        }
        const trackerCID = (await createChannel(msg.guild,
            serversHandler.getServer(serverNames[0])
                .getChannelDisplayName())).id;
        GuildsHandler.addGuildTrackedServer(
            msg.guild.id, serverNames[0], trackerCID);
        msg.channel.send(
            messages.actions.onTrack.replace('$SERVER_NAME', serverNames[0]));
      } else {
        msg.channel.send(
            messages.actions.onServerSearch.alreadyExist
                .replace('$SERVER_NAME', serverNames[0]));
      }
    } else {
      throw Error(messages.errors.invalidGuildID);
    }
  } else {
    msg.channel.send(
        messages.actions.onServerSearch.notFound
            .replace('$SERVER_NAME', serverName));
  }
};

commandFunctions['untrack'] = (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler.
      getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length > 1 && serverNames.length < 20) {
    let reply = messages.actions.onServerSearch.suggest;
    for (const serverName of serverNames) {
      reply += `\n${serverName}`;
    }
    msg.channel.send(reply);
  } else if (serverNames.length > 20) {
    msg.channel.send(messages.actions.onServerSearch.needInfo);
  } else if (serverNames.length === 1) {
    if (GuildsHandler.hasGuild(msg.guild.id)) {
      const guildInfo = GuildsHandler.getGuild(msg.guild.id);
      if (guildInfo.trackedServers[serverNames[0]] !== undefined) {
        let isTrackedOnElseWhere = false;
        for (const guildID of GuildsHandler.getGuildIDs()) {
          if (GuildsHandler.getGuild(guildID).trackedServers[serverNames[0]] !==
            undefined && guildID !== msg.guild.id) {
            isTrackedOnElseWhere = true;
            break;
          }
        }
        if (!isTrackedOnElseWhere) {
          serversHandler.untrackServer(serverNames[0]);
        }
        deleteChannel(guildInfo.trackedServers[serverNames[0]].channelID);
        GuildsHandler.removeGuildTrackedServer(msg.guild.id, serverNames[0]);
        msg.channel.send(messages.actions.onUntrack
            .replace('$SERVER_NAME', serverNames[0]));
      } else {
        msg.channel.send(messages.actions.onServerSearch.notFound
            .replace('$SERVER_NAME', serverNames[0]));
      }
    } else {
      throw Error(messages.errors.invalidGuildID);
    }
  } else {
    msg.channel.send(messages.actions.onServerSearch.notFound
        .replace('$SERVER_NAME', serverName));
  }
};

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
  let isOnline = false;
  if (serverNames.length < 1) {
    msg.channel.send(messages.actions.onServerSearch.unknown);
    return;
  }
  for (const sName of serverNames) {
    if (sName !== null) {
      isOnline = await serversHandler.getServer(sName).isPlayerOn(playerName);
      if (isOnline) {
        msg.channel.send(messages.actions.onPlayerSearch.found
            .replace('$PLAYER_NAME', playerName)
            .replace('$SERVER_NAME', sName));
        break;
      }
    }
  }
  if (!isOnline) {
    if (serverName !== null) {
      msg.channel.send(messages.actions.onPlayerSearch.notFound
          .replace('$PLAYER_NAME', playerName)
          .replace('$SERVER_NAME', serverName));
    } else {
      msg.channel.send(messages.actions.onPlayerSearch.notFoundGeneric
          .replace('$PLAYER_NAME', playerName));
    }
  }
};

commandFunctions['status'] = (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler
      .getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length === 0) {
    msg.channel.send('Unknown Server');
    return;
  }
  for (const sName of serverNames) {
    const status = (serversHandler.getServerStatus(sName) === 0) ?
      messages.server.offline : messages.server.online;
    found = true;
    msg.channel.send(messages.actions.onStatusChange
        .replace('$SERVER_NAME', sName)
        .replace('$STATUS', status));
  }
};

commandFunctions['listplayers'] = async (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler
      .getNamesFromStr(serverName, true, msg.guild.id);
  if (serverNames.length > 0) {
    for (const sName of serverNames) {
      let str = '';
      const server = serversHandler.getServer(sName);
      if (server.status === 1) {
        str += messages.actions.onListPlayers.header
            .replace('$SERVER_NAME', sName);
        for (const player of server.getPlayersList()) {
          str += '\n' + player.name;
        }
        msg.channel.send(str.substring(1));
      } else {
        msg.channel.send(messages.actions.onStatusChange
            .replace('$SERVER_NAME', server.name)
            .replace('$STATUS', 'offline'));
      }
    }
  } else {
    msg.channel.send(messages.actions.onServerSearch.unknown);
  }
};

commandFunctions['rates'] = async (args, msg) => {
  try {
    const res = await axios.get('http://arkdedicated.com/dynamicconfig.ini');
    msg.channel.send(res.data);
  } catch (e) {
    msg.channel.send(messages.actions.onGetRates.failure);
  }
};

commandFunctions['mute'] = (args, msg) => {
  const serverName = args[0];
  if (serverName === 'all') {
    GuildsHandler.setAllTrackedServersMuteStatus(msg.guild.id, true);
    msg.channel.send(messages.actions.onMute.all);
  } else {
    const serverNames = serversHandler
        .getNamesFromStr(serverName, true, msg.guild.id);
    if (serverNames.length === 1) {
      const server = serversHandler.getServer(serverNames[0]);
      GuildsHandler.setTrackedServerMuteStatus(msg.guild.id, server.name, true);
      msg.channel.send(messages.actions.onMute.one
          .replace('$SERVER_NAME', server.name));
    } else if (serverNames.length > 1) {
      msg.channel.send(messages.actions.onServerSearch.needInfo);
    } else {
      msg.channel.send(messages.actions.onServerSearch.unknown);
    }
  }
};

commandFunctions['unmute'] = (args, msg) => {
  const serverName = args[0];
  if (serverName === 'all') {
    GuildsHandler.setAllTrackedServersMuteStatus(msg.guild.id, false);
    msg.channel.send(messages.actions.onUnmute.all);
  } else {
    const serverNames = serversHandler
        .getNamesFromStr(serverName, true, msg.guild.id);
    if (serverNames.length === 1) {
      const server = serversHandler.getServer(serverNames[0]);
      GuildsHandler.setTrackedServerMuteStatus(
          msg.guild.id, server.name, false);
      msg.channel.send(messages.actions.onUnmute.one
          .replace('$SERVER_NAME', server.name));
    } else if (serverNames.length > 1) {
      msg.channel.send(messages.actions.onServerSearch.needInfo);
    } else {
      msg.channel.send(messages.actions.onServerSearch.unknown);
    }
  }
};

commandFunctions['help'] = (args, msg) => {
  let reply = messages.actions.onHelpCommand.listCommands;
  for (const commandName of Object.keys(config.commands)) {
    const command = config.commands[commandName];
    reply += `\`\`\`\n\n${commandName}: ${command.desc}` +
        `\n  ${messages.actions.onHelpCommand.usage}: `;
    if (command.usage.length === 0) {
      reply += `\n    ${config.prefix} ${commandName} `;
    }
    for (const usage of command.usage) {
      reply += `\n    ${config.prefix} ${commandName} ` + `${usage}`;
    }
    reply += `\n  ${messages.actions.onHelpCommand.alias}: ` +
        `${command.alias.reduce((p, c) => p + `, ${c}`)}\`\`\``;
  }
  msg.channel.send(reply);
};

commandFunctions['uptime'] = (args, msg) => {
  const serverName = args[0];
  const serverNames = serversHandler.getNamesFromStr(
      serverName, true, msg.guild.id);
  if (serverNames.length === 0) {
    msg.channel.send(messages.actions.onServerSearch.notFound
        .replace('$SERVER_NAME', serverName));
  } else if (serverNames.length > 1) {
    msg.channel.send(messages.actions.onServerSearch.needInfo);
  } else {
    const server = serversHandler.getServer(serverNames[0]);
    msg.channel.send(messages.actions.onUptimeCommand
        .replace('$SERVER_NAME', server.name)
        .replace('$UP_TIME', server.getUpTimePercentage() * 100));
  }
};

for (const commandName of Object.keys(config.commands)) {
  const commandConfig = config.commands[commandName];
  for (const alias of commandConfig.alias) {
    commandHandler.addCommand(alias, commandConfig,
        commandFunctions[commandName]);
  }
}

client.on('ready', async () => {
  console.log('Logged in as ' + client.user.tag);
  serversHandler.updateServers();
});

client.on('messageCreate', (msg) => {
  if (!msg.content.startsWith(`${config.prefix} `) ||
    msg.author.bot || !msg.guild) return;
  const args = msg.content.slice(4).match(/"[^"]+"|[^\s]+/gm);
  if (!GuildsHandler.hasGuild(msg.guild.id)) {
    GuildsHandler.addGuild(msg.guild.id, msg.channel.id);
  }
  if (args === null) {
    return;
  }
  args.forEach((arg) => arg.replaceAll('"', ''));
  const command = args.shift().toLowerCase();
  commandHandler.run(command, args, msg);
});

client.login(credentials.token);
