# GCS Deployer for Gemini CLI

Share files publicly with a simple command! This Gemini CLI extension uploads your files to Google Cloud Storage and gives you a shareable public link.

<!-- VIDEO_PLACEHOLDER: Add demo video here -->
![Demo Video Placeholder](https://via.placeholder.com/800x400?text=Demo+Video+Coming+Soon)

## ✨ What It Does

- **Instant Sharing**: Upload any file or folder to the cloud
- **Public Links**: Get a shareable URL instantly
- **Smart Defaults**: Remembers your settings so you don't have to repeat them
- **Auto-Login**: Prompts you to sign in if needed

## 🚀 Installation

Make sure you have [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed, then run:

```bash
gemini extensions install SquareShiftTech/gemini-file-sharing
```

That's it! The extension is now ready to use.

## 📖 How to Use

### First Time Setup

The first time you use the extension, you'll need to configure your Google Cloud settings. Just ask Gemini:

> "Configure my GCS deployer with bucket `my-bucket-name` and project `my-project-id`"

### Sharing Files

Once configured, sharing is easy! Just tell Gemini what you want to share:

> "Share this file publicly: `/path/to/my/file.html`"

> "Deploy my website folder to GCS: `/path/to/my/website`"

> "Make this image public: `./screenshot.png`"

Gemini will upload your file and give you a public URL like:
```
https://storage.googleapis.com/your-bucket/site-abc123/file.html
```

### Examples

| What You Say | What Happens |
|--------------|--------------|
| "Share my resume with everyone" | Uploads and returns a public link |
| "Deploy this HTML file publicly" | Uploads to your configured bucket |
| "Configure GCS with bucket `photos` and project `my-gcp`" | Saves your settings for future use |

## ❓ Troubleshooting

**"Authentication failed"**
- The extension will automatically open a browser window for you to sign in with your Google account
- Complete the login and try again

**"Bucket not found"**
- Make sure the bucket exists in your Google Cloud project
- Double-check the bucket name with: "Configure my GCS with bucket `correct-name`"

## 📋 Requirements

- [Gemini CLI](https://github.com/google-gemini/gemini-cli) installed
- A Google Cloud account with a storage bucket
- Node.js 18 or later

## 📄 License

MIT
