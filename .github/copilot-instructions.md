# ioBroker Adapter Development with GitHub Copilot

**Version:** 0.4.0
**Template Source:** https://github.com/DrozmotiX/ioBroker-Copilot-Instructions

This file contains instructions and best practices for GitHub Copilot when working on ioBroker adapter development.

## Project Context

You are working on an ioBroker adapter. ioBroker is an integration platform for the Internet of Things, focused on building smart home and industrial IoT solutions. Adapters are plugins that connect ioBroker to external systems, devices, or services.

### Adapter-Specific Context: Bosch Indego Mower

This adapter connects to Bosch Indego robotic mowers via the Indego Cloud API. Key aspects:

- **Primary Function**: Control and monitor Bosch Indego robotic lawn mowers
- **API Integration**: Uses Bosch Indego Cloud API (https://api.indego-cloud.iot.bosch-si.com)
- **Authentication**: OAuth2-based authentication with session management
- **Key Features**: 
  - Real-time mower status monitoring (docked, mowing, returning, error states)
  - Remote control commands (start/stop/dock/pause)
  - Calendar/schedule management
  - Map visualization and location tracking
  - Alert and error handling
  - Battery status and statistics
- **Dependencies**: 
  - axios for HTTP requests
  - tough-cookie and http-cookie-agent for session management
  - json2iob for object creation
  - qs for query string handling
- **Configuration**: Uses jsonConfig for admin interface with OAuth2 code flow
- **State Management**: Comprehensive state mapping with status codes (258=Docked, 513=Mowing, etc.)

## Testing

### Unit Testing
- Use Jest as the primary testing framework for ioBroker adapters
- Create tests for all adapter main functions and helper methods
- Test error handling scenarios and edge cases
- Mock external API calls and hardware dependencies
- For adapters connecting to APIs/devices not reachable by internet, provide example data files to allow testing of functionality without live connections
- Example test structure:
  ```javascript
  describe('AdapterName', () => {
    let adapter;
    
    beforeEach(() => {
      // Setup test adapter instance
    });
    
    test('should initialize correctly', () => {
      // Test adapter initialization
    });
  });
  ```

### Integration Testing

**IMPORTANT**: Use the official `@iobroker/testing` framework for all integration tests. This is the ONLY correct way to test ioBroker adapters.

**Official Documentation**: https://github.com/ioBroker/testing

#### Framework Structure
Integration tests MUST follow this exact pattern:

```javascript
const path = require('path');
const { tests } = require('@iobroker/testing');

// Define test coordinates or configuration
const TEST_COORDINATES = '52.520008,13.404954'; // Berlin
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// Use tests.integration() with defineAdditionalTests
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Test adapter with specific configuration', (getHarness) => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('Should work with specific config', async () => {
                // Start the adapter and check that it works
                await harness.startAdapterAndWait();
                
                // Your specific tests here
                await wait(5000);
                
                // Check states, objects, etc.
                const state = await harness.states.getStateAsync('adapterName.0.info.connection');
                expect(state).to.be.ok;
            }).timeout(60000);
        });
    },
});
```

#### Key Testing Patterns
- **Mock API responses** for external service calls
- **Test state creation** for all device objects  
- **Validate error handling** when API is unavailable
- **Test configuration validation** with invalid inputs
- **Check connection status** updates properly
- Use proper timeouts (minimum 10 seconds for integration tests)

### Mock Data
For testing without live API connections, use example response files:
- Store mock API responses in `test/fixtures/` directory
- Include example device states, error responses, and configuration data
- Mock authentication flows and session handling

## Architecture Patterns

### Main Class Structure
Follow this pattern for the main adapter class:

```javascript
class AdapterName extends utils.Adapter {
    constructor(options) {
        super({
            ...options,
            name: 'adaptername',
        });
        
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        
        // Initialize class properties
        this.deviceArray = [];
        this.requestClient = null;
    }
    
    async onReady() {
        // Subscribe to states and initialize
    }
    
    async onStateChange(id, state) {
        // Handle state changes
    }
    
    onUnload(callback) {
        // Clean up resources
        callback();
    }
}
```

### State Management
- Use `json2iob` library for creating ioBroker objects from JSON responses
- Implement proper state roles and types:
  ```javascript
  await this.setObjectNotExistsAsync('device.status', {
      type: 'state',
      common: {
          name: 'Device Status',
          type: 'number',
          role: 'indicator.status',
          read: true,
          write: false,
      },
      native: {},
  });
  ```

### HTTP Client Configuration
For API adapters, use axios with proper error handling:

```javascript
this.requestClient = axios.create({
    timeout: 30000,
    withCredentials: true,
});

this.requestClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        this.log.error(`Request failed: ${error.message}`);
        if (error.response?.status === 401) {
            // Handle authentication errors
            await this.refreshAuth();
        }
        throw error;
    }
);
```

## Configuration

### Admin Interface
- Use `jsonConfig` for modern admin interfaces
- Implement proper validation for required fields
- Use appropriate input types (text, password, number, checkbox)
- Support for OAuth2 flows when needed:
  ```json
  {
      "type": "panel",
      "label": "Authentication",
      "items": {
          "username": {
              "type": "text",
              "label": "Username",
              "required": true
          },
          "password": {
              "type": "password", 
              "label": "Password",
              "required": true
          }
      }
  }
  ```

### Configuration Validation
Always validate configuration in `onReady()`:

```javascript
async onReady() {
    if (!this.config.username || !this.config.password) {
        this.log.error('Username and password are required');
        return;
    }
    
    // Continue with initialization
}
```

## Error Handling

### Logging Levels
Use appropriate log levels:
- `this.log.error()` - Critical errors that prevent functionality
- `this.log.warn()` - Non-critical issues that should be addressed  
- `this.log.info()` - Important operational information
- `this.log.debug()` - Detailed diagnostic information

### API Error Handling
Implement comprehensive error handling for API calls:

```javascript
try {
    const response = await this.requestClient.get('/api/endpoint');
    // Handle success
} catch (error) {
    if (error.response) {
        // API responded with error status
        this.log.error(`API Error ${error.response.status}: ${error.response.data}`);
    } else if (error.request) {
        // Network error
        this.log.error(`Network Error: ${error.message}`);
        this.setState('info.connection', false, true);
    } else {
        // Other errors
        this.log.error(`Unexpected Error: ${error.message}`);
    }
}
```

### State Connection Indicator
Always maintain connection status:

```javascript
// Set connected on successful API call
this.setState('info.connection', true, true);

// Set disconnected on errors
this.setState('info.connection', false, true);
```

## Performance & Resource Management

### Memory Management
- Clean up timers and intervals in `onUnload()`
- Close HTTP connections and clear caches
- Unsubscribe from event listeners

```javascript
onUnload(callback) {
    if (this.updateInterval) {
        clearInterval(this.updateInterval);
    }
    
    if (this.requestClient) {
        // Clean up HTTP client resources
    }
    
    callback();
}
```

### API Rate Limiting  
- Implement appropriate delays between API calls
- Use queuing for multiple requests
- Respect API rate limits and implement backoff strategies

```javascript
async updateDevices() {
    for (const device of this.devices) {
        await this.updateDevice(device);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
    }
}
```

## Security

### Credentials Storage
- Store sensitive data in `native` configuration
- Never log passwords or tokens in plain text
- Use encryption for stored tokens when possible

### Input Validation
Always validate and sanitize user inputs:

```javascript
validateConfig(config) {
    const errors = [];
    
    if (!config.username || typeof config.username !== 'string') {
        errors.push('Valid username is required');
    }
    
    if (config.interval && (config.interval < 30 || config.interval > 3600)) {
        errors.push('Interval must be between 30 and 3600 seconds');
    }
    
    return errors;
}
```

## Dependencies & Package Management

### Core Dependencies
Essential packages for most adapters:
- `@iobroker/adapter-core` - Core adapter functionality
- `axios` - HTTP client (preferred over request)
- `node-schedule` - Cron-like scheduling

### Version Management
- Pin major versions to prevent breaking changes
- Keep dependencies updated but test thoroughly
- Use exact versions for critical dependencies

### Development Dependencies
Standard dev dependencies:
- `@iobroker/testing` - Official testing framework
- `eslint` - Code linting  
- `prettier` - Code formatting
- `@alcalzone/release-script` - Release automation

## Code Style & Formatting

### ESLint Configuration
Use the standard ioBroker ESLint configuration:

```javascript
// eslint.config.cjs
module.exports = {
    extends: ['@iobroker/eslint-config'],
    rules: {
        // Add project-specific overrides if needed
        'no-console': 'warn',
    },
};
```

### Prettier Configuration
Standard formatting rules:
```javascript
// .prettierrc.js
module.exports = {
    semi: true,
    singleQuote: true,
    tabWidth: 4,
    trailingComma: 'all',
    printWidth: 120,
};
```

### Code Organization
- Keep main logic in the main adapter class
- Extract utilities to `lib/` directory
- Use TypeScript definitions in `lib/` for better IntelliSense
- Organize related functionality into methods

## Documentation

### README Structure
Follow this structure for adapter README:
1. Logo and badges
2. Brief description
3. Installation instructions
4. Configuration guide
5. Usage examples
6. Changelog
7. License

### Code Documentation
- Use JSDoc comments for all public methods
- Document complex algorithms and business logic
- Include examples in documentation

```javascript
/**
 * Updates device status from API
 * @param {string} deviceId - The device identifier
 * @param {boolean} forceUpdate - Force update even if recently updated
 * @returns {Promise<boolean>} Success status
 */
async updateDeviceStatus(deviceId, forceUpdate = false) {
    // Implementation
}
```

### Changelog Maintenance
- Follow semantic versioning
- Document breaking changes clearly
- Include migration instructions for major updates
- Group changes by type (Added, Changed, Fixed, Removed)

## Release Management

### Version Bumping
Use semantic versioning:
- **Major (x.0.0)** - Breaking changes
- **Minor (0.x.0)** - New features, backward compatible
- **Patch (0.0.x)** - Bug fixes

### Release Process
1. Update version in `package.json` and `io-package.json`
2. Update CHANGELOG.md
3. Test thoroughly
4. Create release with `@alcalzone/release-script`
5. Monitor for issues post-release

### Pre-release Testing
- Test with different ioBroker versions
- Verify on different Node.js versions  
- Test configuration migration
- Check memory usage and performance

## Troubleshooting

### Common Issues
1. **State not updating**: Check state subscriptions and object creation
2. **API connection fails**: Verify credentials and network connectivity  
3. **High memory usage**: Look for memory leaks in timers and event handlers
4. **Slow performance**: Check API call frequency and optimize caching

### Debugging Techniques
- Use debug logging extensively during development
- Implement health check endpoints
- Monitor connection status and API response times
- Use Node.js profiling tools for performance issues

### User Support
- Provide clear error messages with actionable solutions
- Include diagnostic information in logs
- Create troubleshooting guide in README
- Use GitHub issues template for consistent reporting

## ioBroker Ecosystem Integration

### Admin Interface
- Follow ioBroker design patterns for consistency
- Support both compact and normal mode
- Implement proper error handling in admin UI
- Use translations for all user-facing text

### State Roles and Types
Use appropriate ioBroker state roles:
- `indicator.status` - Status indicators
- `switch` - On/off controls  
- `value.temperature` - Temperature readings
- `value.power` - Power measurements
- Custom roles for adapter-specific data

### Object Naming Convention
Follow ioBroker naming patterns:
- `adaptername.instance.device.channel.state`
- Use descriptive names without special characters
- Group related states under channels
- Use consistent naming across similar objects

## Community Standards

### Code Review Guidelines  
- Review for security vulnerabilities
- Check error handling completeness
- Verify test coverage
- Ensure documentation accuracy
- Follow ioBroker coding standards

### Contribution Process
1. Fork repository and create feature branch
2. Implement changes with tests
3. Update documentation
4. Submit pull request with clear description
5. Address review feedback promptly

### Community Support
- Respond to GitHub issues promptly
- Help with troubleshooting in community forums
- Contribute to ioBroker documentation
- Share knowledge through blog posts or tutorials

## Additional Resources

### Official Documentation
- [ioBroker Adapter Development](https://github.com/ioBroker/ioBroker.docs/blob/master/docs/en/dev/adapterdev.md)
- [Testing Framework](https://github.com/ioBroker/testing)
- [Admin Configuration](https://github.com/ioBroker/ioBroker.admin/blob/master/packages/jsonConfig/README.md)

### Community Resources
- [ioBroker Forum](https://forum.iobroker.net/)
- [Discord Channel](https://discord.gg/5jGWNKnpZ8)
- [GitHub Organization](https://github.com/ioBroker)

### Development Tools
- [Create Adapter Tool](https://github.com/ioBroker/create-adapter)
- [Adapter Checker](https://github.com/ioBroker/adapter-checker)
- [Translation Tool](https://github.com/ioBroker/ioBroker.admin/tree/master/packages/translator)

Remember: When in doubt, follow existing patterns from well-maintained ioBroker adapters and refer to the official documentation.