# Markdown Support Enhancement for OpenClaw DingTalk Plugin

## Summary
This pull request enhances the DingTalk channel plugin with comprehensive Markdown support for the OpenClaw project.

## Features Added

### 1. Intelligent Markdown Detection
- Implemented `containsMarkdownSyntax()` function that detects various Markdown syntax elements
- Supports headers, bold, italic, links, lists, code blocks, blockquotes, and more
- Uses regex patterns to identify Markdown syntax accurately

### 2. Smart Message Formatting
- Enhanced `sendMessageDingTalk()` function to automatically detect Markdown content
- When Markdown syntax is detected, messages are sent using DingTalk's markdown message type
- Maintains backward compatibility for plain text messages
- Works for both session webhook replies and direct API calls

### 3. Improved User Experience
- Formatted messages now render properly in DingTalk client
- Rich text support for better readability
- No breaking changes to existing functionality

## Technical Details

### Changes Made
- **Modified**: `src/send.ts` - Added markdown detection and smart formatting
- **Added**: Helper function for markdown syntax detection
- **Enhanced**: Message payload construction logic
- **Preserved**: All existing functionality for other message types

### Detection Patterns
The markdown detection supports:
- Headers: `# Header`, `## Header`, etc.
- Bold: `**bold**`, `__bold__`
- Italic: `*italic*`, `_italic_`
- Links: `[text](url)`
- Images: `![alt](url)`
- Lists: `- item`, `* item`, `1. item`
- Code: ``inline code``, ```code blocks```
- Blockquotes: `> quote`

## Testing
- Function tested with various markdown patterns
- Backward compatibility verified with plain text messages
- Integration tested with existing message flow

## Benefits
1. **Better Formatting**: Markdown content renders properly in DingTalk
2. **Enhanced UX**: Users see formatted text instead of raw markdown
3. **Automatic Detection**: No manual configuration needed
4. **Compatibility**: Works with existing OpenClaw integration

## Migration Notes
This enhancement is part of the Moltbot → OpenClaw migration project:
- All references updated from Moltbot to OpenClaw
- Package name changed to `@openclaw/dingtalk`
- Maintains full compatibility with OpenClaw platform