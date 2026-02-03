// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "IWebSocket.h"
#include "LogCapture.h"
#include "ErrorParser.h"

DECLARE_MULTICAST_DELEGATE_OneParam(FOnWebSocketConnected, bool);
DECLARE_MULTICAST_DELEGATE_OneParam(FOnWebSocketMessage, const FString&);

/**
 * WebSocket client for connecting to Gorka Copilot Overlay
 */
class GORKACOPILOTCONNECTOR_API FGorkaWebSocketClient : public TSharedFromThis<FGorkaWebSocketClient>
{
public:
	FGorkaWebSocketClient();
	~FGorkaWebSocketClient();

	/** Initialize with server URL */
	void Initialize(const FString& ServerUrl);

	/** Shutdown the client */
	void Shutdown();

	/** Connect to server */
	void Connect();

	/** Disconnect from server */
	void Disconnect();

	/** Check if connected */
	bool IsConnected() const;

	/** Send a JSON event */
	void SendEvent(const TSharedPtr<FJsonObject>& Event);

	/** Send project info event */
	void SendProjectInfo();

	/** Send log entry event */
	void SendLogEntry(const FGorkaLogEntry& Entry);

	/** Send error block event */
	void SendErrorBlock(const FGorkaErrorBlock& ErrorBlock);

	/** Send context snapshot */
	void SendContextSnapshot(const TArray<FGorkaLogEntry>& Logs, const FGorkaErrorBlock* LastError);

	/** Connection events */
	FOnWebSocketConnected OnConnected;
	FOnWebSocketMessage OnMessageReceived;

private:
	/** WebSocket instance */
	TSharedPtr<IWebSocket> WebSocket;

	/** Server URL */
	FString ServerUrl;

	/** Connection state */
	bool bIsConnected;

	/** Reconnect timer handle */
	FTimerHandle ReconnectTimerHandle;

	/** Heartbeat timer handle */
	FTimerHandle HeartbeatTimerHandle;

	/** Reconnect attempt counter */
	int32 ReconnectAttempts;

	/** Maximum reconnect attempts */
	static const int32 MaxReconnectAttempts = 10;

	/** Heartbeat interval in seconds */
	static const float HeartbeatInterval;

	/** Reconnect delay in seconds */
	static const float ReconnectDelay;

	/** WebSocket event handlers */
	void OnWebSocketConnected();
	void OnWebSocketConnectionError(const FString& Error);
	void OnWebSocketClosed(int32 StatusCode, const FString& Reason, bool bWasClean);
	void OnWebSocketMessage(const FString& Message);

	/** Schedule a reconnect attempt */
	void ScheduleReconnect();

	/** Cancel reconnect timer */
	void CancelReconnect();

	/** Send heartbeat */
	void SendHeartbeat();

	/** Start heartbeat timer */
	void StartHeartbeat();

	/** Stop heartbeat timer */
	void StopHeartbeat();

	/** Convert verbosity to string */
	static FString VerbosityToString(ELogVerbosity::Type Verbosity);

	/** Convert error type to string */
	static FString ErrorTypeToString(EGorkaErrorType Type);

	/** Get current timestamp */
	static int64 GetTimestamp();
};
