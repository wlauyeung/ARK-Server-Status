const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { clientId, guildId, token } = require('./credentials.json');
const config = require('./config.json');

const commands = [];

for (const cmdName of Object.keys(config.commands)) {
  const cmdConfig = config.commands[cmdName];
  const command = new SlashCommandBuilder()
    .setName(cmdConfig.alias[0])
    .setDescription(cmdConfig.desc);
  if (cmdConfig.usage.length > 0) {
    const cmdUsage = cmdConfig.usage[0].split(' ');
    for (const usage of cmdUsage) {
      command.addStringOption(option =>
        option.setName(usage)
          .setDescription(`The ${usage}`)
          .setRequired(true));
    }
  }
  commands.push(command.toJSON());
}

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
	try {
		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		const data = await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		console.error(error);
	}
})();