// Copyright Gorka Copilot Team. All Rights Reserved.

#include "LogCapture.h"
#include "GorkaCopilotSettings.h"
#include "Misc/OutputDeviceRedirector.h"

FGorkaLogOutputDevice::FGorkaLogOutputDevice()
	: MaxBufferSize(200)
	, bIsInitialized(false)
{
}

FGorkaLogOutputDevice::~FGorkaLogOutputDevice()
{
	Shutdown();
}

void FGorkaLogOutputDevice::Initialize()
{
	if (bIsInitialized)
	{
		return;
	}

	// Get settings
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
	if (Settings)
	{
		MaxBufferSize = Settings->LogBufferSize;
	}

	// Reserve buffer space
	LogBuffer.Reserve(MaxBufferSize);

	// Register with the output device redirector
	GLog->AddOutputDevice(this);

	bIsInitialized = true;
}

void FGorkaLogOutputDevice::Shutdown()
{
	if (!bIsInitialized)
	{
		return;
	}

	// Unregister from the output device redirector
	if (GLog)
	{
		GLog->RemoveOutputDevice(this);
	}

	// Clear buffer
	FScopeLock Lock(&BufferLock);
	LogBuffer.Empty();

	bIsInitialized = false;
}

TArray<FGorkaLogEntry> FGorkaLogOutputDevice::GetRecentLogs(int32 Count) const
{
	FScopeLock Lock(&BufferLock);

	if (Count <= 0 || LogBuffer.Num() == 0)
	{
		return TArray<FGorkaLogEntry>();
	}

	const int32 StartIndex = FMath::Max(0, LogBuffer.Num() - Count);
	const int32 NumElements = FMath::Min(Count, LogBuffer.Num());

	TArray<FGorkaLogEntry> Result;
	Result.Reserve(NumElements);

	for (int32 i = StartIndex; i < LogBuffer.Num(); ++i)
	{
		Result.Add(LogBuffer[i]);
	}

	return Result;
}

TArray<FGorkaLogEntry> FGorkaLogOutputDevice::GetAllLogs() const
{
	FScopeLock Lock(&BufferLock);
	return LogBuffer;
}

void FGorkaLogOutputDevice::ClearBuffer()
{
	FScopeLock Lock(&BufferLock);
	LogBuffer.Empty();
}

void FGorkaLogOutputDevice::Serialize(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category)
{
	if (!bIsInitialized || !ShouldCapture(Verbosity))
	{
		return;
	}

	FGorkaLogEntry Entry(Category, Verbosity, Message);
	AddEntry(Entry);
}

void FGorkaLogOutputDevice::Serialize(const TCHAR* Message, ELogVerbosity::Type Verbosity, const FName& Category, double Time)
{
	// Just forward to the simpler version - we capture our own timestamp
	Serialize(Message, Verbosity, Category);
}

bool FGorkaLogOutputDevice::ShouldCapture(ELogVerbosity::Type Verbosity) const
{
	const UGorkaCopilotSettings* Settings = GetDefault<UGorkaCopilotSettings>();
	if (!Settings)
	{
		return Verbosity <= ELogVerbosity::Warning;
	}

	switch (Verbosity)
	{
	case ELogVerbosity::Fatal:
	case ELogVerbosity::Error:
		return true;

	case ELogVerbosity::Warning:
		return Settings->bCaptureWarnings;

	case ELogVerbosity::Display:
	case ELogVerbosity::Log:
		return true;

	case ELogVerbosity::Verbose:
	case ELogVerbosity::VeryVerbose:
		return Settings->bCaptureVerbose;

	default:
		return false;
	}
}

void FGorkaLogOutputDevice::AddEntry(const FGorkaLogEntry& Entry)
{
	{
		FScopeLock Lock(&BufferLock);

		// Add to buffer
		LogBuffer.Add(Entry);

		// Trim if needed (keep it as a sliding window)
		if (LogBuffer.Num() > MaxBufferSize)
		{
			LogBuffer.RemoveAt(0, LogBuffer.Num() - MaxBufferSize);
		}
	}

	// Fire event (outside of lock to prevent deadlocks)
	OnLogEntryCaptured.Broadcast(Entry);
}
