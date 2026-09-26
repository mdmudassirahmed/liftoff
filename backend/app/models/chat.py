"""Chat request and response models."""
from pydantic import BaseModel, Field
from typing import Optional, List


class ChatMessage(BaseModel):
    """A single chat message."""
    role: str = Field(..., description="Message role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ChatRequest(BaseModel):
    """Request body for chat endpoint."""
    message: str = Field(..., description="User's message")
    conversation_history: Optional[List[ChatMessage]] = Field(
        default=[],
        description="Previous conversation messages for context"
    )
    context: Optional[str] = Field(
        default=None,
        description="Optional diagram context (JSON) to ground the conversation"
    )


class ChatResponse(BaseModel):
    """Response body from chat endpoint."""
    response: str = Field(..., description="Assistant's response")
    sources: Optional[List[str]] = Field(
        default=None,
        description="Source URLs from Microsoft Learn MCP"
    )
    mcp_enhanced: bool = Field(
        default=False,
        description="Whether the response was enhanced by MCP"
    )


class ChatStreamChunk(BaseModel):
    """A streaming chunk for SSE responses."""
    content: str = Field(..., description="Partial content")
    done: bool = Field(default=False, description="Whether streaming is complete")
    sources: Optional[List[str]] = Field(default=None)
    mcp_enhanced: Optional[bool] = Field(default=None)
