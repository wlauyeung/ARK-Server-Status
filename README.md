# Minecraft-Server-Status
A Discord bot designed to track Minecraft servers

## Config
| Option | Usage |
| ------------- | ------------- |
| `prefix` | The prefix of a command. |
| `token` | The token of a Discord bot.      |
| `queryInterval` | The interval in seconds which the bot query all the servers. |
| `offlineCounterThreshold` | The threshold for how many offline queries a server can get before considered as offline. |
| `defaultMute` | Whether a new channel should be muted by default. |
| `commands.[commandName].admin` | Whether this command requires administrator privilege. |
| `commands.[commandName].alias` | All the aliases of the command. |
| `commands.[commandName].usage` | All the arguments of the command. |

## Commands
| Command | Description | Usage |
| ------------- | ------------- | ------------- |
| `setchannel` | Sets the notification channel. | `<channel>` |
| `track` | Add a server to the tracking list. | `<server_name> <ip> <port>` |
| `untrack` | Remove a server from the tracking list. | `<server_name>` |
| `stalk` | Check whether a player is currently on servers containing `<server_name>`. | `<server_name> <player_name>` OR `<player_name>` |
| `status` | Quick check the status of a server. | `<server_name>` |
| `mute` | Mute all or a server. | `all` OR `<server_name>` |
| `unmute` | Unmute all or a server. | `all` OR `<server_name>` |
