# MCP Server for GLPI v2.0

A comprehensive Model Context Protocol (MCP) server providing full integration with GLPI (Gestionnaire Libre de Parc Informatique) for AI assistants like Claude.

## What's New in v2.0

- **ITIL Support**: Full Problem and Change management
- **Asset Management**: Computers, Software, Network Equipment, Printers, Monitors, Phones
- **Knowledge Base**: Search and create KB articles
- **Contract & Supplier Management**: Track contracts and vendors
- **Project Management**: Create and track projects
- **Statistics**: Ticket and asset dashboards
- **60+ Tools**: Comprehensive GLPI coverage

## Features

### Ticket Management (ITIL Incidents/Requests)
| Tool | Description |
|------|-------------|
| `glpi_list_tickets` | List tickets with filters |
| `glpi_get_ticket` | Get ticket details with followups and tasks |
| `glpi_create_ticket` | Create a new ticket |
| `glpi_update_ticket` | Update ticket fields |
| `glpi_delete_ticket` | Delete a ticket |
| `glpi_add_followup` | Add a followup comment |
| `glpi_add_task` | Add a task with time tracking |
| `glpi_add_solution` | Add solution to close ticket |
| `glpi_assign_ticket` | Assign ticket to user/group |
| `glpi_get_ticket_tasks` | Get all tasks |
| `glpi_get_ticket_followups` | Get all followups |

### Problem Management (ITIL)
| Tool | Description |
|------|-------------|
| `glpi_list_problems` | List problems |
| `glpi_get_problem` | Get problem details |
| `glpi_create_problem` | Create a new problem |
| `glpi_update_problem` | Update a problem |

### Change Management (ITIL)
| Tool | Description |
|------|-------------|
| `glpi_list_changes` | List changes |
| `glpi_get_change` | Get change details |
| `glpi_create_change` | Create a new change |
| `glpi_update_change` | Update a change |

### Asset Management
| Tool | Description |
|------|-------------|
| `glpi_list_computers` | List computers/workstations |
| `glpi_get_computer` | Get computer with software/connections |
| `glpi_create_computer` | Add computer to inventory |
| `glpi_update_computer` | Update computer |
| `glpi_delete_computer` | Remove computer |
| `glpi_list_softwares` | List software |
| `glpi_get_software` | Get software details |
| `glpi_create_software` | Add software |
| `glpi_list_network_equipments` | List switches/routers |
| `glpi_get_network_equipment` | Get network device |
| `glpi_list_printers` | List printers |
| `glpi_get_printer` | Get printer details |
| `glpi_list_monitors` | List monitors |
| `glpi_get_monitor` | Get monitor details |
| `glpi_list_phones` | List phones |
| `glpi_get_phone` | Get phone details |

### Knowledge Base
| Tool | Description |
|------|-------------|
| `glpi_list_knowbase` | List KB articles |
| `glpi_get_knowbase_item` | Get article content |
| `glpi_search_knowbase` | Search knowledge base |
| `glpi_create_knowbase_item` | Create new article |

### Contract & Supplier Management
| Tool | Description |
|------|-------------|
| `glpi_list_contracts` | List contracts |
| `glpi_get_contract` | Get contract details |
| `glpi_create_contract` | Create contract |
| `glpi_list_suppliers` | List suppliers |
| `glpi_get_supplier` | Get supplier details |
| `glpi_create_supplier` | Create supplier |

### Project Management
| Tool | Description |
|------|-------------|
| `glpi_list_projects` | List projects |
| `glpi_get_project` | Get project details |
| `glpi_create_project` | Create project |
| `glpi_update_project` | Update project progress |

### User & Group Management
| Tool | Description |
|------|-------------|
| `glpi_list_users` | List users |
| `glpi_get_user` | Get user details |
| `glpi_search_user` | Search user by name |
| `glpi_create_user` | Create new user |
| `glpi_list_groups` | List groups |
| `glpi_get_group` | Get group details |
| `glpi_create_group` | Create group |
| `glpi_add_user_to_group` | Add user to group |

### Other Tools
| Tool | Description |
|------|-------------|
| `glpi_list_categories` | List ticket categories |
| `glpi_list_locations` | List locations |
| `glpi_get_location` | Get location details |
| `glpi_create_location` | Create location |
| `glpi_list_entities` | List entities |
| `glpi_get_entity` | Get entity details |
| `glpi_list_documents` | List documents |
| `glpi_get_document` | Get document details |
| `glpi_get_ticket_stats` | Ticket statistics |
| `glpi_get_asset_stats` | Asset inventory stats |
| `glpi_get_session_info` | Current session info |
| `glpi_search` | Advanced multi-criteria search |

### Resources (Quick Access)
| Resource URI | Description |
|--------------|-------------|
| `glpi://tickets/open` | All open tickets |
| `glpi://tickets/recent` | Recent tickets |
| `glpi://problems/open` | Open problems |
| `glpi://changes/pending` | Pending changes |
| `glpi://computers` | All computers |
| `glpi://groups` | All groups |
| `glpi://categories` | Ticket categories |
| `glpi://stats/tickets` | Ticket statistics |
| `glpi://stats/assets` | Asset statistics |

## Installation

```bash
npm install -g mcp-glpi
```

Or use directly with npx:

```bash
npx mcp-glpi
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GLPI_URL` | Yes | Base URL of your GLPI instance |
| `GLPI_APP_TOKEN` | No | Application token from GLPI API settings |
| `GLPI_USER_TOKEN` | No* | User API token |
| `GLPI_USERNAME` | No* | Username for basic auth |
| `GLPI_PASSWORD` | No* | Password for basic auth |

*Either `GLPI_USER_TOKEN` or `GLPI_USERNAME`/`GLPI_PASSWORD` is required.

### GLPI API Setup

1. Go to **Setup > General > API** in GLPI
2. Enable the REST API
3. Create an API client and note the App Token
4. For user authentication, either:
   - Use a User Token (found in user preferences under "Remote access keys")
   - Or use username/password authentication

### Claude Desktop Configuration

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "glpi": {
      "command": "npx",
      "args": ["mcp-glpi"],
      "env": {
        "GLPI_URL": "https://your-glpi-instance.com",
        "GLPI_APP_TOKEN": "your-app-token",
        "GLPI_USER_TOKEN": "your-user-token"
      }
    }
  }
}
```

## Usage Examples

Once configured, you can ask Claude to:

### Ticket Management
- "List all open tickets in GLPI"
- "Show me ticket #123 with all its tasks"
- "Create a new incident for a printer issue"
- "Add a solution to ticket #456"
- "Assign ticket #789 to the support team"

### Problem & Change Management
- "List all open problems"
- "Create a change request for the server upgrade"
- "Show me pending changes for approval"

### Asset Management
- "List all computers in the inventory"
- "Show me computer PC-001 with its installed software"
- "Add a new workstation to the inventory"
- "List all network equipment"

### Knowledge Base
- "Search the knowledge base for VPN setup"
- "Create a KB article about password reset"
- "List FAQ articles"

### Reports & Statistics
- "Show me ticket statistics"
- "Give me an asset inventory summary"
- "How many tickets are pending?"

## Status References

### Ticket Status
| ID | Label |
|----|-------|
| 1 | New |
| 2 | Processing (assigned) |
| 3 | Processing (planned) |
| 4 | Pending |
| 5 | Solved |
| 6 | Closed |

### Problem Status
| ID | Label |
|----|-------|
| 1 | New |
| 2 | Accepted |
| 3 | Planned |
| 4 | Pending |
| 5 | Solved |
| 6 | Closed |

### Change Status
| ID | Label |
|----|-------|
| 1 | New |
| 2 | Evaluation |
| 3 | Approval |
| 4 | Accepted |
| 5 | Pending |
| 6 | Test |
| 7 | Qualification |
| 8 | Applied |
| 9 | Review |
| 10 | Closed |

### Urgency/Priority
| ID | Label |
|----|-------|
| 1 | Very low |
| 2 | Low |
| 3 | Medium |
| 4 | High |
| 5 | Very high |

## Development

### Building from source

```bash
git clone https://github.com/GMS64260/mcp-glpi.git
cd mcp-glpi
npm install
npm run build
```

### Running locally

```bash
export GLPI_URL="https://your-glpi-instance.com"
export GLPI_USER_TOKEN="your-token"
npm start
```

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Links

- [GLPI Project](https://glpi-project.org/)
- [GLPI API Documentation](https://glpi-user-documentation.readthedocs.io/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [NPM Package](https://www.npmjs.com/package/mcp-glpi)
