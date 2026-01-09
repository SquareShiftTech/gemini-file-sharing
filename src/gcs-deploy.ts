#!/usr/bin/env node
import { Storage } from '@google-cloud/storage';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import mime from 'mime-types';
import { ConfigManager } from './config.js';
import { spawn } from 'child_process';


// Define interface for dependencies
interface GcsDeployDeps {
  storage?: any; // strict typing for google-cloud/storage is complex to mock fully
  spawner?: typeof spawn;
}

export class GcsDeployServer {
  // @ts-ignore - public for testing
  public server: Server;
  private storage: any;
  private spawner: typeof spawn;

  constructor(deps: GcsDeployDeps = {}) {
    this.storage = deps.storage || new Storage();
    this.spawner = deps.spawner || spawn;

    this.server = new Server(
      {
        name: 'gcs-deployer',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Expose for testing
  public getRequestHandler() {
    // @ts-ignore - accessing private property for testing access
    return this.server.requestHandlers.get(CallToolRequestSchema.method);
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'deploy_to_gcs',
          description: 'Uploads a file or directory to Google Cloud Storage and makes it public. Use this when the user asks to "share this file with public", "share this file with everyone", or similar requests to publish content.',
          inputSchema: {
            type: 'object',
            properties: {
              sourcePath: {
                type: 'string',
                description: 'Local path to the file or directory to deploy',
              },
              bucketName: {
                type: 'string',
                description: 'The GCS bucket to deploy to. Optional if configured via configure_gcs.',
              },
              destinationPrefix: {
                type: 'string',
                description: 'Optional folder path in the bucket',
              },
            },
            required: ['sourcePath'],
          },
        },
        {
          name: 'configure_gcs',
          description: 'Sets the default Google Cloud Project and GCS Bucket for deployment. Use this if deploy_to_gcs fails due to missing configuration.',
          inputSchema: {
            type: 'object',
            properties: {
              bucketName: {
                type: 'string',
                description: 'The GCS bucket to use by default',
              },
              projectId: {
                type: 'string',
                description: 'The Google Cloud Project ID',
              },
              subfolder: {
                type: 'string',
                description: 'Default subfolder to deploy to (optional)',
              }
            },
            required: ['bucketName'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === 'configure_gcs') {
        const args = request.params.arguments as any;
        ConfigManager.save({
          bucketName: args.bucketName,
          projectId: args.projectId,
          subfolder: args.subfolder
        });
        return {
          content: [
            {
              type: 'text',
              text: `Configuration saved for bucket '${args.bucketName}'${args.projectId ? ` in project '${args.projectId}'` : ''}${args.subfolder ? ` with subfolder '${args.subfolder}'` : ''}.`,
            },
          ],
        };
      }

      if (request.params.name === 'deploy_to_gcs') {
        const args = request.params.arguments as any;
        const sourcePath = args.sourcePath;
        let bucketName = args.bucketName;
        const destinationPrefix = args.destinationPrefix || '';

        // Load config if not provided
        if (!bucketName) {
          bucketName = ConfigManager.getBucket();
        }

        const projectId = ConfigManager.getProject();
        let finalDestinationPrefix = destinationPrefix;

        // Sticky Subfolder Logic
        if (!finalDestinationPrefix) {
          const storedSubfolder = ConfigManager.getSubfolder();
          if (storedSubfolder) {
            finalDestinationPrefix = storedSubfolder;
          } else {
            // Generate random subfolder
            const randomId = Math.random().toString(36).substring(2, 8); // e.g. "x7z91a"
            finalDestinationPrefix = `site-${randomId}`;
            // Persist it
            ConfigManager.save({ subfolder: finalDestinationPrefix });
            console.error(`Generated and saved new default subfolder: ${finalDestinationPrefix}`);
          }
        }

        if (!sourcePath) {
          throw new McpError(ErrorCode.InvalidParams, 'Missing required argument: sourcePath');
        }

        // Check for missing config
        const missingItems: string[] = [];
        if (!bucketName) missingItems.push('bucketName');
        if (!projectId) missingItems.push('projectId');

        if (missingItems.length > 0) {
          return {
            content: [
              {
                type: 'text',
                text: `GCS configuration missing: ${missingItems.join(', ')}. \nPlease run the "configure_gcs" tool to set your Google Cloud Project ID and GCS Bucket Name.`,
              }
            ],
            isError: true
          };
        }

        try {
          // Get Identity
          const identity = await this.getCurrentIdentity();

          // Log Pre-flight
          const preflightMsg = `Deploying '${sourcePath}' to bucket '${bucketName}' in project '${projectId}' using identity '${identity}' (subfolder: '${finalDestinationPrefix}')...`;
          console.error(preflightMsg); // Log to stderr (visible in MCP inspector/logs)

          const publicUrls = await this.deploy(sourcePath, bucketName!, finalDestinationPrefix);
          return {
            content: [
              {
                type: 'text',
                text: `${preflightMsg}\n\nSuccessfully deployed to GCS. Public URLs:\n${publicUrls.join('\n')}`,
              },
            ],
          };
        } catch (error: any) {
          return {
            content: [
              {
                type: 'text',
                text: `Error deploying to GCS: ${error.message}`,
              },
            ],
            isError: true,
          };
        }
      }

      throw new McpError(ErrorCode.MethodNotFound, 'Unknown tool');
    });
  }

  private async getCurrentIdentity(): Promise<string> {
    return new Promise((resolve) => {
      // Try gcloud first as it's likely what we use for auth
      const child = this.spawner('gcloud', ['config', 'get-value', 'account'], { shell: true });
      let stdout = '';
      child.stdout?.on('data', (d) => stdout += d.toString());
      child.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim());
        } else {
          resolve('unknown (could not determine identity)');
        }
      });
    });
  }

  private async deploy(sourcePath: string, bucketName: string, destinationPrefix: string): Promise<string[]> {
    const bucket = this.storage.bucket(bucketName);
    const urls: string[] = [];
    const stats = fs.statSync(sourcePath);

    try {
      if (stats.isFile()) {
        const destination = path.join(destinationPrefix, path.basename(sourcePath));
        const url = await this.uploadFile(bucket, sourcePath, destination);
        urls.push(url);
      } else if (stats.isDirectory()) {
        const files = this.getAllFiles(sourcePath);
        for (const file of files) {
          const relativePath = path.relative(sourcePath, file);
          const destination = path.join(destinationPrefix, relativePath);
          const url = await this.uploadFile(bucket, file, destination);
          urls.push(url);
        }
      } else {
        throw new Error('sourcePath must be a file or directory');
      }
    } catch (error: any) {
      // Check for common authentication errors
      // Code 401 is usually unauthenticated / invalid credentials
      // "Could not load the default credentials" is a common error message from google-auth-library
      const isAuthError =
        error.code === 401 ||
        (error.message && (
          error.message.includes('Could not load the default credentials') ||
          error.message.includes('Anonymous caller does not have storage.objects.create access')
        ));

      if (isAuthError) {
        console.error('Authentication error detected. Attempting to launch gcloud auth...');
        try {
          await this.attemptAutoAuth();
          throw new Error('Authentication was missing. I have launched the "gcloud auth application-default login" command in a new window. Please complete the login process there and then try this request again.');
        } catch (authError: any) {
          // If auto-auth fails (e.g. gcloud not installed), throw original error with hint
          throw new Error(`Authentication failed and could not launch gcloud: ${authError.message}. Original error: ${error.message}`);
        }
      }
      throw error;
    }

    return urls;
  }

  private attemptAutoAuth(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Spawn gcloud in a new shell/window if possible, or just inherit stdio
      // For CLI tools, inheriting stdio is usually best so user can interact
      // User requested least privilege: only ask permission to write files.
      // We need 'devstorage.full_control' to allow 'makePublic' (ACL changes).
      // If we only needed write, 'devstorage.read_write' would work, but makePublic might fail.
      // Let's use full_control for storage but NOT cloud-platform.
      const scopes = 'https://www.googleapis.com/auth/devstorage.full_control';

      const child = this.spawner('gcloud', [
        'auth',
        'application-default',
        'login',
        `--scopes=${scopes}`
      ], {
        stdio: 'inherit',
        shell: true
      });

      child.on('error', (err: any) => reject(err));

      // We don't want to wait for it to finish successfully because it blocks.
      // But the user needs to finish it. 
      // Actually, if we return immediately, the tool call finishes and the user might miss the prompt if it's buried in logs.
      // Ideally we wait for it. The user will see the login prompt in their terminal or browser.
      child.on('close', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`gcloud exited with code ${code}`));
      });
    });
  }

  private getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach((file) => {
      if (fs.statSync(dirPath + '/' + file).isDirectory()) {
        arrayOfFiles = this.getAllFiles(dirPath + '/' + file, arrayOfFiles);
      } else {
        arrayOfFiles.push(path.join(dirPath, '/', file));
      }
    });

    return arrayOfFiles;
  }

  private async uploadFile(bucket: any, filePath: string, destination: string): Promise<string> {
    const contentType = mime.lookup(filePath) || 'application/octet-stream';

    await bucket.upload(filePath, {
      destination: destination,
      metadata: {
        cacheControl: 'public, max-age=31536000',
        contentType: contentType,
      },
    });

    const file = bucket.file(destination);

    // Attempt to make public. Note: This might fail if Uniform Bucket Level Access is enabled.
    // In that case, the bucket policy must already allow public read.
    try {
      await file.makePublic();
    } catch (err: any) {
      // If we can't make specific object public, assume bucket is public or warn
      console.warn(`Could not make file ${destination} explicitly public (might be uniform bucket access): ${err.message}`);
    }

    return `https://storage.googleapis.com/${bucket.name}/${destination}`;
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('GCS Deploy MCP server running on stdio');
  }
}

// Only auto-run if we are NOT in test mode
// This ensures that for the user, it always runs.
// Verification scripts should set MCP_TEST_MODE='true' before importing.
if (process.env.MCP_TEST_MODE !== 'true') {
  const server = new GcsDeployServer();
  server.run().catch(console.error);
}
