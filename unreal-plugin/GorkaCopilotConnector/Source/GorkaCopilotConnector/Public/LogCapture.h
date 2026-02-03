// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Misc/OutputDevice.h"

/**
 * Structure representing a captured log entry
 */
struct FGorkaLogEntry
{
	FDateTime Timestamp;
	FName Category;
	ELogVerbosity::Type Verbosity;
	FString Message;

	FGorkaLogEntry()
		: Timestamp(FDateTime::Now())
		, Category(NAME_None)
		, Verbosity(ELogVerbosity::Log)
	{
	}

	FGorkaLogEntry(const FName& InCategory, ELogVerbosity::Type InVerbosity, const FString& InMessage)
		: Timestamp(FDateTime::Now())
		, Category(InCategory)
		, Verbosity(InVerbosity)
		, Message(InMessage)
	{
	}
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnLogEntryCaptured, const FGorkaLogEntry&);

/**
 * Custom output device that captures log messages
 */
class GORKACOPILOTCONNECTOR_API FGorkaLogOutputDevice : public FOutputDevice
{
public:
	FGorkaLogOutputDevice();
	virtual ~FGorkaLogOutputDevice();

	/** Initialize and register the output device */
	void Initialize();

	/** Shutdown and unregister the output device */
	void Shutdown();

	/** Get recent log entries */
	TArray<FGorkaLogEntry> GetRecentLogs(int32 Count = 200) const;

	/** Get all buffered logs */
	TArray<FGorkaLogEntry> GetAllLogs() const;

	/** Clear the log buffer */
	void ClearBuffer();

	/** Event fired when a new log entry is captured */
	FOnLogEntryCaptured OnLogEntryCaptured;

protected:
	/** FOutputDevice interface */
	virtual void Serialize(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category) override;
	virtual void Serialize(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category, double Time) override;
	virtual bool CanBeUsedOnAnyThread() const override { return true; }
	virtual bool CanBeUsedOnMultipleThreads() const override { return true; }

private:
	/** Circular buffer for log entries */
	TArray<FGorkaLogEntry> LogBuffer;

	/** Maximum buffer size */
	int32 MaxBufferSize;

	/** Lock for thread-safe access */
	mutable FCriticalSection BufferLock;

	/** Whether the device is initialized */
	bool bIsInitialized;

	/** Add entry to buffer */
	void AddEntry(const FGorkaLogEntry& Entry);

	/** Check if verbosity level should be captured */
	bool ShouldCapture(ELogVerbosity::Type Verbosity) const;
};
