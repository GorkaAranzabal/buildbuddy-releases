// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GorkaCopilotSettings.generated.h"

/**
 * Settings for the Gorka Copilot Connector plugin
 */
UCLASS(Config=GorkaCopilot, DefaultConfig, meta=(DisplayName="Gorka Copilot"))
class GORKACOPILOTCONNECTOR_API UGorkaCopilotSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UGorkaCopilotSettings();

	/** Server host address (default: 127.0.0.1) */
	UPROPERTY(Config, EditAnywhere, Category="Connection")
	FString ServerHost;

	/** Server port (default: 9876) */
	UPROPERTY(Config, EditAnywhere, Category="Connection", meta=(ClampMin="1024", ClampMax="65535"))
	int32 ServerPort;

	/** Auto-connect when editor starts */
	UPROPERTY(Config, EditAnywhere, Category="Connection")
	bool bAutoConnect;

	/** Reconnect automatically if connection is lost */
	UPROPERTY(Config, EditAnywhere, Category="Connection")
	bool bAutoReconnect;

	/** Maximum reconnect attempts before giving up */
	UPROPERTY(Config, EditAnywhere, Category="Connection", meta=(ClampMin="1", ClampMax="100", EditCondition="bAutoReconnect"))
	int32 MaxReconnectAttempts;

	/** Number of log lines to keep in buffer */
	UPROPERTY(Config, EditAnywhere, Category="Logging", meta=(ClampMin="50", ClampMax="1000"))
	int32 LogBufferSize;

	/** Capture warning messages */
	UPROPERTY(Config, EditAnywhere, Category="Logging")
	bool bCaptureWarnings;

	/** Capture verbose messages (may impact performance) */
	UPROPERTY(Config, EditAnywhere, Category="Logging")
	bool bCaptureVerbose;

	/** Enable streaming log entries in real-time */
	UPROPERTY(Config, EditAnywhere, Category="Logging")
	bool bStreamLogs;

	/** Get the WebSocket URL */
	FString GetWebSocketURL() const;

	/** Get the category name for settings UI */
	virtual FName GetCategoryName() const override { return TEXT("Plugins"); }

	/** Get the section name for settings UI */
	virtual FName GetSectionName() const override { return TEXT("Gorka Copilot"); }
};
