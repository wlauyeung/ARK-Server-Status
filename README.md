# ARK-Server-Status
A Discord bot designed to track ARK servers

## Config
| Option | Usage |
| ------------- | ------------- |
| prefix | The prefix of a command. |
| token | The token of a Discord bot.      |
| channelID | The ID of the notification channel.      |
| queryInterval | The interval in seconds which the bot query all the servers. |
| offlineCounterThreshold | The threshold for how many offline queries a server can get before considered as offline. |

## Commands
| Command | Description | Usage |
| ------------- | ------------- | ------------- |
| `setchannel` | Sets the notification channel. | `setchannel <channel>` |
| `track` | Add a server to the tracking list. | `track <server_name> <ip> <port>` |
| `untrack` | Remove a server from the tracking list. | `untrack <server_name>` |
| `list` | List all tracked servers along with their status. | `list` |
| `stalk` | Check whether a player is currently on servers containing `<server_name>`. | `stalk <server_name> <player_name>` |
| `status` | Quick check the status of a server. | `status <server_name>` |
