import swaggerJSDoc from 'swagger-jsdoc';
import path from 'path';
import fs from 'fs';

const apiDir = path.join(__dirname, '../api');
const jsGlobPattern = path.join(__dirname, '../api/*.js');
const tsGlobPattern = path.join(__dirname, '../api/*.ts');

let apis: string[];

if (fs.existsSync(apiDir)) {
  const files = fs.readdirSync(apiDir);
  const hasJsFiles = files.some(file => file.endsWith('.js'));
  const hasTsFiles = files.some(file => file.endsWith('.ts'));
  
  if (hasJsFiles) {
    apis = [jsGlobPattern];
  } else if (hasTsFiles) {
    apis = [tsGlobPattern];
  } else {
    throw new Error('No valid API files found! Ensure either .js or .ts files exist in the ../api/ directory.');
  }
} else {
  throw new Error('API directory not found! Ensure the ../api/ directory exists.');
}

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Website to API',
      version: '1.0.0',
      description:
        'Maxun lets you get the data your robot extracted and run robots via API. All you need to do is input the Maxun API key by clicking Authorize below.',
    },
    components: {
      securitySchemes: {
        api_key: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description:
            'API key for authorization. You can find your API key in the "API Key" section on Maxun Dashboard.',
        },
      },
    },
    security: [
      {
        api_key: [], // Apply this security scheme globally
      },
    ],
  },
  apis,
};

const swaggerSpec = swaggerJSDoc(options);

export default swaggerSpec;
