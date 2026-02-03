// Copyright Gorka Copilot Team. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonObject.h"

DECLARE_MULTICAST_DELEGATE_TwoParams(FOnCommandResult, const FString& /* CommandId */, const TSharedPtr<FJsonObject>& /* Result */);

/**
 * Handles commands received from the desktop app
 * Can create blueprints, C++ files, add actors to levels, etc.
 */
class GORKACOPILOTCONNECTOR_API FGorkaCommandHandler
{
public:
	FGorkaCommandHandler();
	~FGorkaCommandHandler();

	/** Process a command received from the desktop app */
	void ProcessCommand(const TSharedPtr<FJsonObject>& Command);

	/** Callback for command results */
	FOnCommandResult OnCommandResult;

private:
	// ===== Blueprint Operations =====
	
	/** Create a new Blueprint asset */
	TSharedPtr<FJsonObject> CreateBlueprint(const TSharedPtr<FJsonObject>& Params);
	
	/** Open a Blueprint in the editor */
	TSharedPtr<FJsonObject> OpenBlueprint(const TSharedPtr<FJsonObject>& Params);
	
	/** Add a component to a Blueprint */
	TSharedPtr<FJsonObject> AddComponentToBlueprint(const TSharedPtr<FJsonObject>& Params);
	
	/** Add a variable to a Blueprint */
	TSharedPtr<FJsonObject> AddVariableToBlueprint(const TSharedPtr<FJsonObject>& Params);
	
	/** Compile a Blueprint */
	TSharedPtr<FJsonObject> CompileBlueprint(const TSharedPtr<FJsonObject>& Params);

	// ===== C++ Operations =====
	
	/** Create a new C++ class */
	TSharedPtr<FJsonObject> CreateCppClass(const TSharedPtr<FJsonObject>& Params);
	
	/** Open a source file in the IDE */
	TSharedPtr<FJsonObject> OpenSourceFile(const TSharedPtr<FJsonObject>& Params);

	// ===== Level Operations =====
	
	/** Spawn an actor in the current level */
	TSharedPtr<FJsonObject> SpawnActor(const TSharedPtr<FJsonObject>& Params);
	
	/** Delete an actor from the level */
	TSharedPtr<FJsonObject> DeleteActor(const TSharedPtr<FJsonObject>& Params);
	
	/** Get all actors in the current level */
	TSharedPtr<FJsonObject> GetLevelActors(const TSharedPtr<FJsonObject>& Params);
	
	/** Select an actor in the editor */
	TSharedPtr<FJsonObject> SelectActor(const TSharedPtr<FJsonObject>& Params);

	// ===== Asset Operations =====
	
	/** Get assets by path or type */
	TSharedPtr<FJsonObject> GetAssets(const TSharedPtr<FJsonObject>& Params);
	
	/** Open the Content Browser to a specific path */
	TSharedPtr<FJsonObject> BrowseToAsset(const TSharedPtr<FJsonObject>& Params);
	
	/** Import an asset */
	TSharedPtr<FJsonObject> ImportAsset(const TSharedPtr<FJsonObject>& Params);
	
	/** Delete an asset */
	TSharedPtr<FJsonObject> DeleteAsset(const TSharedPtr<FJsonObject>& Params);

	// ===== Editor Operations =====
	
	/** Play in Editor (PIE) */
	TSharedPtr<FJsonObject> PlayInEditor(const TSharedPtr<FJsonObject>& Params);
	
	/** Stop PIE */
	TSharedPtr<FJsonObject> StopPlayInEditor(const TSharedPtr<FJsonObject>& Params);
	
	/** Save all assets */
	TSharedPtr<FJsonObject> SaveAll(const TSharedPtr<FJsonObject>& Params);
	
	/** Compile project */
	TSharedPtr<FJsonObject> CompileProject(const TSharedPtr<FJsonObject>& Params);
	
	/** Get project information */
	TSharedPtr<FJsonObject> GetProjectInfo(const TSharedPtr<FJsonObject>& Params);
	
	/** Execute console command */
	TSharedPtr<FJsonObject> ExecuteConsoleCommand(const TSharedPtr<FJsonObject>& Params);

	// ===== Utility =====
	
	/** Create a success result */
	TSharedPtr<FJsonObject> MakeSuccessResult(const FString& Message);
	
	/** Create an error result */
	TSharedPtr<FJsonObject> MakeErrorResult(const FString& Error);
	
	/** Create a result with data */
	TSharedPtr<FJsonObject> MakeResultWithData(bool bSuccess, const TSharedPtr<FJsonObject>& Data);
};
