// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "LogCapture.h"

/**
 * Error type classification
 */
UENUM()
enum class EGorkaErrorType : uint8
{
	Packaging,
	Compile,
	Runtime,
	Blueprint,
	Unknown
};

/**
 * Structure representing a parsed error block
 */
struct FGorkaErrorBlock
{
	EGorkaErrorType Type;
	FString RawBlock;
	TArray<FString> FilePaths;
	TArray<FString> AssetPaths;
	TArray<int32> LineNumbers;
	FDateTime Timestamp;

	FGorkaErrorBlock()
		: Type(EGorkaErrorType::Unknown)
		, Timestamp(FDateTime::Now())
	{
	}
};

DECLARE_MULTICAST_DELEGATE_OneParam(FOnErrorBlockDetected, const FGorkaErrorBlock&);

/**
 * Parses log entries to detect and classify error blocks
 */
class GORKACOPILOTCONNECTOR_API FGorkaErrorParser
{
public:
	FGorkaErrorParser();

	/** Process a log entry and detect errors */
	void ProcessLogEntry(const FGorkaLogEntry& Entry);

	/** Get all detected error blocks */
	TArray<FGorkaErrorBlock> GetErrorBlocks() const;

	/** Get the last detected error block */
	FGorkaErrorBlock GetLastErrorBlock() const;

	/** Clear all error blocks */
	void ClearErrorBlocks();

	/** Event fired when an error block is detected */
	FOnErrorBlockDetected OnErrorBlockDetected;

private:
	/** Detected error blocks */
	TArray<FGorkaErrorBlock> ErrorBlocks;

	/** Lock for thread-safe access */
	mutable FCriticalSection ErrorLock;

	/** Current error block being accumulated */
	FGorkaErrorBlock CurrentBlock;

	/** Whether we're currently accumulating an error block */
	bool bInErrorBlock;

	/** Lines accumulated for current block */
	TArray<FString> AccumulatedLines;

	/** Maximum error blocks to keep */
	static const int32 MaxErrorBlocks = 50;

	/** Classify error type from message content */
	EGorkaErrorType ClassifyError(const FString& Message);

	/** Check if line starts an error block */
	bool IsErrorStart(const FString& Message, ELogVerbosity::Type Verbosity);

	/** Check if line ends an error block */
	bool IsErrorEnd(const FString& Message);

	/** Extract file paths from error block */
	void ExtractFilePaths(const FString& Block, TArray<FString>& OutPaths);

	/** Extract asset paths from error block */
	void ExtractAssetPaths(const FString& Block, TArray<FString>& OutPaths);

	/** Extract line numbers from error block */
	void ExtractLineNumbers(const FString& Block, TArray<int32>& OutLineNumbers);

	/** Finalize and store current error block */
	void FinalizeErrorBlock();
};
