# Changelog

## [Unreleased] - Upcoming Changes

## [1.0.3] - Enhanced Chat View with Recommendations Panel

### ✨ New Features
- **Recommendations Panel**: Added intelligent question suggestions based on active file content
  - AI-generated questions appear when chat initializes with an active file
  - Questions are rendered as a vertical list below existing chat history
  - Clicking a question directly sends it as a message
  - Panel automatically refreshes and provides loading states

### 🔧 Improvements
- **Message Rendering**: Introduced suggestion anchor index for proper placement of recommendations
  - Recommendations appear between existing history and new messages
  - New messages render below the recommendations section
  - Maintains proper scroll behavior and message order

- **Chat Interface**: Enhanced overall chat experience
  - Auto-resizing textarea with improved height management
  - Better key event handling for message sending
  - Enhanced text selection within chat interface
  - Improved message layout and spacing

- **Message Actions**: Added interactive features
  - Copy button for response messages
  - Enhanced code block rendering
  - Better visibility of action buttons

- **Chat History**: Implemented persistence and management
  - Automatic saving and loading of conversation history
  - Reset functionality to clear conversations
  - Abort ongoing requests with proper error handling

### 🎨 UI/UX Enhancements
- **Chat Bubbles**: Improved styling and layout
  - Better white-space handling for markdown content
  - Enhanced indentation for lists and blockquotes
  - Model information display in chat bubbles
  - Visual separation between input area and messages

- **Responsive Design**: Better layout management
  - Improved message width handling
  - Better margin and padding for message layout
  - Enhanced input area positioning

### 🏗️ Architecture
- **Code Organization**: Refactored for better maintainability
  - Extracted recommendations logic into separate `RecommendationsPanel` class
  - Improved separation of concerns
  - Better cleanup and resource management

### ⚙️ Technical Details
- **System Prompts**: Implemented fixed system prompt for article analysis
- **File Integration**: Active file content automatically included in chat context
- **Error Handling**: Enhanced abort request handling and logging
- **Performance**: Improved message rendering and state management

---

## [1.1.0] - Chat Interface Enhancements and Persistence

### 🔧 Improvements
- **Chat History**: Implemented persistence and management
  - Automatic saving and loading of conversation history
  - Reset functionality to clear conversations
  - Abort ongoing requests with proper error handling

- **Chat Interface**: Enhanced overall chat experience
  - Auto-resizing textarea with improved height management
  - Better key event handling for message sending
  - Enhanced text selection within chat interface
  - Improved message layout and spacing

- **Message Actions**: Added interactive features
  - Copy button for response messages
  - Enhanced code block rendering
  - Better visibility of action buttons

### 🎨 UI/UX Enhancements
- **Chat Bubbles**: Improved styling and layout
  - Better white-space handling for markdown content
  - Enhanced indentation for lists and blockquotes
  - Model information display in chat bubbles
  - Visual separation between input area and messages

- **Responsive Design**: Better layout management
  - Improved message width handling
  - Better margin and padding for message layout
  - Enhanced input area positioning

### ⚙️ Technical Details
- **System Prompts**: Implemented fixed system prompt for article analysis
- **File Integration**: Active file content automatically included in chat context
- **Error Handling**: Enhanced abort request handling and logging
- **Performance**: Improved message rendering and state management

---

## [1.0.0] - Initial Chat Functionality

### ✨ Core Features
- Basic chat interface with Ollama integration
- Message sending and receiving
- Markdown rendering for responses
- Model information display

---

*This changelog covers the most recent 10 commits, showcasing the evolution from basic chat functionality to a sophisticated chat interface with AI-powered recommendations and enhanced user experience.*
