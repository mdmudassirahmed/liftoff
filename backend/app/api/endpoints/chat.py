"""
Chat endpoint using Azure AI Foundry agents.
Calls published agents via AgentRegistry.
"""
import time
import json
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

from app.models.chat import ChatRequest, ChatResponse
from app.agents.foundry import AgentRegistry
from app.api.errors import to_http_error
from app.core.logging import get_logger, set_correlation_id

router = APIRouter()
logger = get_logger(__name__)


# ==================== Architecture Advisor Models ====================

class ArchitectureAdvisorRequest(BaseModel):
    """Request for architecture advisor chat."""
    message: str = Field(..., description="User's question about architecture")
    diagram_context: Optional[Dict[str, Any]] = Field(
        None,
        description="Current diagram (nodes and edges) for context-aware responses"
    )
    conversation_history: Optional[List[Dict[str, str]]] = Field(
        default=[],
        description="Previous messages in the conversation"
    )


class ArchitectureAdvisorResponse(BaseModel):
    """Response from architecture advisor."""
    response: str = Field(..., description="Advisor's response with recommendations")
    sources: Optional[List[str]] = Field(
        default=None,
        description="Source references from Microsoft Learn"
    )
    agent_name: str = Field(..., description="Name of the agent that responded")
    duration_ms: float = Field(..., description="Response time in milliseconds")


@router.post("", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Chat endpoint using Azure AI Foundry azure-docs-agent.
    
    - **message**: The user's question or message
    - **conversation_history**: Previous messages for context
    - **context**: Optional diagram JSON for architecture-aware responses
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    msg_preview = request.message[:80] if len(request.message) > 80 else request.message
    context_size = len(request.context) if request.context else 0
    history_count = len(request.conversation_history or [])
    
    logger.info(
        f"Chat request | "
        f"message='{msg_preview}' | "
        f"history={history_count} | "
        f"context_size={context_size}"
    )
    
    try:
        # Build message with context
        full_message = request.message
        
        # Add conversation history if present
        if request.conversation_history:
            history_text = "\n".join([
                f"{msg.role}: {msg.content}" 
                for msg in request.conversation_history[-5:]  # Last 5 messages
            ])
            full_message = f"Previous conversation:\n{history_text}\n\nUser: {request.message}"
        
        # Ground the answer in the current diagram when one is supplied
        if request.context:
            full_message = f"Current architecture (JSON):\n{request.context}\n\n{full_message}"

        # Call azure-docs-agent via registry
        response = await AgentRegistry.search_docs(full_message)
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        logger.info(
            f"Chat completed | "
            f"agent={response.agent_name} | "
            f"response_length={len(response.content)} | "
            f"duration_ms={elapsed_ms:.2f}"
        )
        
        return ChatResponse(
            response=response.content,
            sources=response.sources,
            mcp_enhanced=True  # Using Foundry agents
        )
        
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.error(
            f"Chat failed | error={str(e)} | duration_ms={elapsed_ms:.2f}",
            exc_info=True
        )
        raise to_http_error(e) from e


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """
    Streaming chat endpoint (non-streaming fallback).
    
    Note: Foundry agents don't support streaming in the same way,
    so we get the full response and yield it in chunks.
    """
    async def event_generator():
        try:
            # Get response from agent
            response = await AgentRegistry.search_docs(request.message)
            
            # Yield content in chunks to simulate streaming
            content = response.content
            chunk_size = 50
            
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i+chunk_size]
                yield {
                    "event": "message",
                    "data": json.dumps({"content": chunk, "done": False})
                }
            
            yield {
                "event": "message", 
                "data": json.dumps({"content": "", "done": True})
            }
            
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
    
    return EventSourceResponse(event_generator())


@router.get("/status")
async def get_agent_status():
    """Check if Foundry agents are available."""
    try:
        agents = AgentRegistry.list_agents()
        return {
            "agents_available": len(agents) > 0,
            "agents": list(agents.keys()),
            "status": "connected"
        }
    except Exception as e:
        return {
            "agents_available": False,
            "agents": [],
            "status": f"error: {str(e)}"
        }


# ==================== Architecture Advisor Endpoint ====================

@router.post("/advisor", response_model=ArchitectureAdvisorResponse)
async def architecture_advisor(request: ArchitectureAdvisorRequest):
    """
    Architecture Advisor chat endpoint using Azure Docs Agent with MCP.
    
    This endpoint provides enterprise-grade architecture recommendations
    based on Microsoft's best practices and the user's current diagram context.
    
    - **message**: User's question about architecture
    - **diagram_context**: Current diagram (nodes and edges) for context-aware responses
    - **conversation_history**: Previous messages for multi-turn conversations
    """
    set_correlation_id()
    start_time = time.perf_counter()
    
    msg_preview = request.message[:80] if len(request.message) > 80 else request.message
    has_diagram = request.diagram_context is not None
    history_count = len(request.conversation_history or [])
    
    logger.info(
        f"Architecture advisor request | "
        f"message='{msg_preview}' | "
        f"has_diagram={has_diagram} | "
        f"history={history_count}"
    )
    
    try:
        # Build enhanced prompt with diagram context
        prompt_parts = []
        
        # System context for the advisor
        prompt_parts.append("""You are an Azure Architecture Advisor powered by Microsoft Learn documentation.
Your role is to provide enterprise-grade, production-ready architecture recommendations based on Microsoft's best practices.

GUIDELINES:
- Always reference Azure Well-Architected Framework pillars (Reliability, Security, Cost, Operations, Performance)
- Recommend enterprise patterns (hub-spoke, microservices, event-driven)
- Suggest security best practices (managed identities, private endpoints, RBAC)
- Consider scalability, high availability, and disaster recovery
- Provide specific Azure service recommendations with justification
- Reference Microsoft Learn documentation when available""")
        
        # Add diagram context if provided
        if request.diagram_context:
            nodes = request.diagram_context.get("nodes", [])
            edges = request.diagram_context.get("edges", [])
            
            # Extract meaningful info from nodes
            services = []
            for node in nodes:
                if node.get("type") == "azure.service":
                    data = node.get("data", {})
                    services.append({
                        "name": data.get("label", "Unknown"),
                        "type": data.get("resourceType", "Unknown"),
                        "properties": data.get("properties", {})
                    })
            
            if services:
                prompt_parts.append(f"""
CURRENT ARCHITECTURE CONTEXT:
The user has the following Azure services in their diagram:
{json.dumps(services, indent=2)}

Number of connections/dependencies: {len(edges)}

Consider this context when providing recommendations. Suggest improvements, 
identify potential issues, and recommend additional services that would 
enhance this architecture.""")
        
        # Add conversation history
        if request.conversation_history:
            history_text = "\n".join([
                f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                for msg in request.conversation_history[-5:]  # Last 5 messages
            ])
            prompt_parts.append(f"\nPREVIOUS CONVERSATION:\n{history_text}")
        
        # Add the user's current question
        prompt_parts.append(f"\nUSER QUESTION:\n{request.message}")
        
        # Add instruction for response format
        prompt_parts.append("""
RESPONSE FORMAT:
- Start with a direct answer to the question
- Include specific recommendations with Azure service names
- Reference Microsoft best practices
- If relevant, suggest architecture patterns
- Keep responses concise but comprehensive""")
        
        full_prompt = "\n\n".join(prompt_parts)
        
        # Call azure-docs-agent via registry
        response = await AgentRegistry.search_docs(full_prompt)
        
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        
        logger.info(
            f"Architecture advisor completed | "
            f"agent={response.agent_name} | "
            f"response_length={len(response.content)} | "
            f"duration_ms={elapsed_ms:.2f}"
        )
        
        return ArchitectureAdvisorResponse(
            response=response.content,
            sources=response.sources,
            agent_name=response.agent_name,
            duration_ms=elapsed_ms
        )
        
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        logger.error(
            f"Architecture advisor failed | error={str(e)} | duration_ms={elapsed_ms:.2f}",
            exc_info=True
        )
        raise to_http_error(e) from e


@router.post("/advisor/stream")
async def architecture_advisor_stream(request: ArchitectureAdvisorRequest):
    """
    Streaming Architecture Advisor endpoint.
    
    Provides real-time streaming responses for architecture recommendations.
    """
    async def event_generator():
        try:
            # Build prompt same as non-streaming version
            prompt_parts = []
            
            prompt_parts.append("""You are an Azure Architecture Advisor powered by Microsoft Learn documentation.
Provide enterprise-grade, production-ready architecture recommendations based on Microsoft's best practices.
Reference Azure Well-Architected Framework. Be concise but comprehensive.""")
            
            if request.diagram_context:
                nodes = request.diagram_context.get("nodes", [])
                services = []
                for node in nodes:
                    if node.get("type") == "azure.service":
                        data = node.get("data", {})
                        services.append({
                            "name": data.get("label", "Unknown"),
                            "type": data.get("resourceType", "Unknown")
                        })
                
                if services:
                    prompt_parts.append(f"CURRENT ARCHITECTURE: {json.dumps(services)}")
            
            if request.conversation_history:
                history_text = "\n".join([
                    f"{msg.get('role', 'user')}: {msg.get('content', '')}"
                    for msg in request.conversation_history[-3:]
                ])
                prompt_parts.append(f"HISTORY:\n{history_text}")
            
            prompt_parts.append(f"QUESTION: {request.message}")
            
            full_prompt = "\n\n".join(prompt_parts)
            
            # Get response from agent
            response = await AgentRegistry.search_docs(full_prompt)
            
            # Stream in chunks
            content = response.content
            chunk_size = 30  # Smaller chunks for smoother streaming
            
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i+chunk_size]
                yield {
                    "event": "message",
                    "data": json.dumps({
                        "content": chunk,
                        "done": False,
                        "agent_name": response.agent_name
                    })
                }
            
            yield {
                "event": "message",
                "data": json.dumps({
                    "content": "",
                    "done": True,
                    "sources": response.sources,
                    "agent_name": response.agent_name
                })
            }
            
        except Exception as e:
            logger.error(f"Advisor stream error: {e}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e)})
            }
    
    return EventSourceResponse(event_generator())
