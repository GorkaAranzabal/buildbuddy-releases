// Copyright Gorka Copilot Team. All Rights Reserved.

#include "ErrorParser.h"
#include "Misc/RegexUtils.h"

FGorkaErrorParser::FGorkaErrorParser()
	: bInErrorBlock(false)
{
}

void FGorkaErrorParser::ProcessLogEntry(const FGorkaLogEntry& Entry)
{
	// Check if this is an error-level message
	if (Entry.Verbosity == ELogVerbosity::Error || Entry.Verbosity == ELogVerbosity::Fatal)
	{
		// Start a new error block
		if (!bInErrorBlock)
		{
			bInErrorBlock = true;
			AccumulatedLines.Empty();
			CurrentBlock = FGorkaErrorBlock();
			CurrentBlock.Type = ClassifyError(Entry.Message);
			CurrentBlock.Timestamp = Entry.Timestamp;
		}

		AccumulatedLines.Add(Entry.Message);

		// Check if this might be the end of an error block
		// We'll finalize after a few more lines or when we get a non-error message
	}
	else if (bInErrorBlock)
	{
		// Non-error message while in error block
		// Check if it's a continuation (stack trace, etc.)
		if (Entry.Message.Contains(TEXT("at ")) || 
		    Entry.Message.Contains(TEXT("Error:")) ||
		    Entry.Message.Contains(TEXT("error:")) ||
		    Entry.Message.StartsWith(TEXT("    ")) ||
		    Entry.Message.StartsWith(TEXT("\t")))
		{
			AccumulatedLines.Add(Entry.Message);
		}
		else
		{
			// End of error block
			FinalizeErrorBlock();
		}
	}

	// Also check for specific error patterns that indicate immediate errors
	if (IsErrorStart(Entry.Message, Entry.Verbosity))
	{
		if (!bInErrorBlock)
		{
			bInErrorBlock = true;
			AccumulatedLines.Empty();
			CurrentBlock = FGorkaErrorBlock();
			CurrentBlock.Type = ClassifyError(Entry.Message);
			CurrentBlock.Timestamp = Entry.Timestamp;
		}
		AccumulatedLines.Add(Entry.Message);
	}
}

EGorkaErrorType FGorkaErrorParser::ClassifyError(const FString& Message)
{
	const FString LowerMessage = Message.ToLower();

	// Check for packaging errors
	if (LowerMessage.Contains(TEXT("packaging")) || 
	    LowerMessage.Contains(TEXT("cook")) ||
	    LowerMessage.Contains(TEXT("pak file")) ||
	    LowerMessage.Contains(TEXT("staging")))
	{
		return EGorkaErrorType::Packaging;
	}

	// Check for compile errors
	if (LowerMessage.Contains(TEXT("compile")) ||
	    LowerMessage.Contains(TEXT("c2065")) ||  // MSVC undeclared identifier
	    LowerMessage.Contains(TEXT("c2061")) ||  // MSVC syntax error
	    LowerMessage.Contains(TEXT("lnk")) ||    // MSVC linker errors
	    LowerMessage.Contains(TEXT(".cpp(")) ||  // C++ file reference
	    LowerMessage.Contains(TEXT(".h(")))      // Header file reference
	{
		return EGorkaErrorType::Compile;
	}

	// Check for Blueprint errors
	if (LowerMessage.Contains(TEXT("blueprint")) ||
	    LowerMessage.Contains(TEXT("bp_")) ||
	    LowerMessage.Contains(TEXT(".uasset")) ||
	    LowerMessage.Contains(TEXT("graph")) ||
	    LowerMessage.Contains(TEXT("node")))
	{
		return EGorkaErrorType::Blueprint;
	}

	// Check for runtime errors
	if (LowerMessage.Contains(TEXT("runtime")) ||
	    LowerMessage.Contains(TEXT("crash")) ||
	    LowerMessage.Contains(TEXT("assertion")) ||
	    LowerMessage.Contains(TEXT("access violation")) ||
	    LowerMessage.Contains(TEXT("nullptr")))
	{
		return EGorkaErrorType::Runtime;
	}

	return EGorkaErrorType::Unknown;
}

bool FGorkaErrorParser::IsErrorStart(const FString& Message, ELogVerbosity::Type Verbosity)
{
	if (Verbosity != ELogVerbosity::Error && Verbosity != ELogVerbosity::Fatal)
	{
		return false;
	}

	// Check for common error patterns
	return Message.Contains(TEXT("Error:")) ||
	       Message.Contains(TEXT("error:")) ||
	       Message.Contains(TEXT("FAILED")) ||
	       Message.Contains(TEXT("Exception:")) ||
	       Message.Contains(TEXT("Assertion failed"));
}

bool FGorkaErrorParser::IsErrorEnd(const FString& Message)
{
	// Check for patterns that typically end error blocks
	return Message.IsEmpty() ||
	       Message.Contains(TEXT("Build completed")) ||
	       Message.Contains(TEXT("Compilation complete")) ||
	       (!Message.StartsWith(TEXT(" ")) && !Message.StartsWith(TEXT("\t")) && 
	        !Message.Contains(TEXT("error")) && !Message.Contains(TEXT("Error")));
}

void FGorkaErrorParser::ExtractFilePaths(const FString& Block, TArray<FString>& OutPaths)
{
	// Pattern: /Path/To/File.cpp or C:\Path\To\File.cpp
	// Also matches: File.cpp(123)
	
	TArray<FString> Lines;
	Block.ParseIntoArrayLines(Lines);

	for (const FString& Line : Lines)
	{
		// Look for .cpp, .h, .c files
		int32 ExtIndex;
		if (Line.FindChar('.', ExtIndex))
		{
			FString Extension = Line.Mid(ExtIndex, 4).ToLower();
			if (Extension.StartsWith(TEXT(".cpp")) || 
			    Extension.StartsWith(TEXT(".h")) ||
			    Extension.StartsWith(TEXT(".c")))
			{
				// Try to extract the full path
				int32 PathStart = 0;
				
				// Look for beginning of path
				for (int32 i = ExtIndex; i >= 0; --i)
				{
					TCHAR C = Line[i];
					if (C == ' ' || C == '\t' || C == '"' || C == '\'')
					{
						PathStart = i + 1;
						break;
					}
				}

				// Find end of path (look for ( or space after extension)
				int32 PathEnd = ExtIndex + 4;
				for (int32 i = ExtIndex + 1; i < Line.Len(); ++i)
				{
					TCHAR C = Line[i];
					if (C == '(' || C == ' ' || C == '\t' || C == '"' || C == '\'')
					{
						PathEnd = i;
						break;
					}
					PathEnd = i + 1;
				}

				FString Path = Line.Mid(PathStart, PathEnd - PathStart);
				if (Path.Len() > 2)
				{
					OutPaths.AddUnique(Path);
				}
			}
		}
	}
}

void FGorkaErrorParser::ExtractAssetPaths(const FString& Block, TArray<FString>& OutPaths)
{
	// Pattern: /Game/Path/To/Asset or Blueprint'/Game/...'
	
	TArray<FString> Lines;
	Block.ParseIntoArrayLines(Lines);

	for (const FString& Line : Lines)
	{
		// Look for /Game/ pattern
		int32 GameIndex = Line.Find(TEXT("/Game/"));
		if (GameIndex != INDEX_NONE)
		{
			// Find end of path
			int32 PathEnd = GameIndex;
			for (int32 i = GameIndex; i < Line.Len(); ++i)
			{
				TCHAR C = Line[i];
				if (C == '\'' || C == '"' || C == ' ' || C == ')')
				{
					PathEnd = i;
					break;
				}
				PathEnd = i + 1;
			}

			FString Path = Line.Mid(GameIndex, PathEnd - GameIndex);
			OutPaths.AddUnique(Path);
		}
	}
}

void FGorkaErrorParser::ExtractLineNumbers(const FString& Block, TArray<int32>& OutLineNumbers)
{
	// Pattern: file.cpp(123) or file.cpp:123
	
	// Simple regex-like pattern matching for (number) or :number
	for (int32 i = 0; i < Block.Len() - 1; ++i)
	{
		TCHAR C = Block[i];
		if (C == '(' || C == ':')
		{
			// Check if followed by digits
			int32 NumStart = i + 1;
			int32 NumEnd = NumStart;
			while (NumEnd < Block.Len() && Block[NumEnd] >= '0' && Block[NumEnd] <= '9')
			{
				NumEnd++;
			}

			if (NumEnd > NumStart && (C == ':' || Block[NumEnd] == ')'))
			{
				FString NumStr = Block.Mid(NumStart, NumEnd - NumStart);
				int32 LineNum = FCString::Atoi(*NumStr);
				if (LineNum > 0 && LineNum < 100000)  // Reasonable line number
				{
					OutLineNumbers.AddUnique(LineNum);
				}
			}
		}
	}
}

void FGorkaErrorParser::FinalizeErrorBlock()
{
	if (!bInErrorBlock || AccumulatedLines.Num() == 0)
	{
		return;
	}

	// Build the raw block
	CurrentBlock.RawBlock = FString::Join(AccumulatedLines, TEXT("\n"));

	// Extract paths and line numbers
	ExtractFilePaths(CurrentBlock.RawBlock, CurrentBlock.FilePaths);
	ExtractAssetPaths(CurrentBlock.RawBlock, CurrentBlock.AssetPaths);
	ExtractLineNumbers(CurrentBlock.RawBlock, CurrentBlock.LineNumbers);

	// Store the error block
	{
		FScopeLock Lock(&ErrorLock);
		ErrorBlocks.Add(CurrentBlock);

		// Trim if needed
		if (ErrorBlocks.Num() > MaxErrorBlocks)
		{
			ErrorBlocks.RemoveAt(0, ErrorBlocks.Num() - MaxErrorBlocks);
		}
	}

	// Fire event
	OnErrorBlockDetected.Broadcast(CurrentBlock);

	// Reset state
	bInErrorBlock = false;
	AccumulatedLines.Empty();
	CurrentBlock = FGorkaErrorBlock();
}

TArray<FGorkaErrorBlock> FGorkaErrorParser::GetErrorBlocks() const
{
	FScopeLock Lock(&ErrorLock);
	return ErrorBlocks;
}

FGorkaErrorBlock FGorkaErrorParser::GetLastErrorBlock() const
{
	FScopeLock Lock(&ErrorLock);
	if (ErrorBlocks.Num() > 0)
	{
		return ErrorBlocks.Last();
	}
	return FGorkaErrorBlock();
}

void FGorkaErrorParser::ClearErrorBlocks()
{
	FScopeLock Lock(&ErrorLock);
	ErrorBlocks.Empty();
}
