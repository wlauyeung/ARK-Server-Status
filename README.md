# ARK-Server-Status
A Discord bot designed to track ARK servers

[![ESLint](https://github.com/wlauyeung/ARK-Server-Status/actions/workflows/eslint.yml/badge.svg)](https://github.com/wlauyeung/ARK-Server-Status/actions/workflows/eslint.yml)

## Config
| Option | Usage |
| ------------- | ------------- |
| `prefix` | The prefix of a command. |
| `serverListUpdateInterval` | Interval of how often an update should be made to the list of supported official servers in DAYS. |
| `queryInterval` | The interval in seconds which the bot query all the servers. |
| `offlineCounterThreshold` | The threshold for how many offline queries a server can get before considered as offline. |
| `defaultMute` | Whether a new server should be muted by default. |
| `gsCooldown` | The cooldown for a global stalker update in seconds. |
| `gsTimeout` | The timeout for a global stalker update in seconds. |
| `commands.[commandName].admin` | Whether this command requires administrator privilege. |
| `commands.[commandName].desc` | The description of the command. |
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
| `rates` | When the rates of official servers. | No arguments needed |
| `mute` | Mute all or a server. | `all` OR `<server_name>` |
| `unmute` | Unmute all or a server. | `all` OR `<server_name>` |
| `help` | Display the list of available commands | No arguments needed |
| `uptime` | Check the uptime percentage of a server | `<server_name>` |
| `globalstalk` | Look for a player across all official servers | `<player_name>` |
| `playercount` | Display the number of online players on the offical network | No arguments needed |
