// Copyright Gorka Copilot Team. All Rights Reserved.

#include "CommandHandler.h"
#include "Editor.h"
#include "Engine/World.h"
#include "Engine/Blueprint.h"
#include "Engine/BlueprintGeneratedClass.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "AssetToolsModule.h"
#include "IAssetTools.h"
#include "Factories/BlueprintFactory.h"
#include "GameFramework/Actor.h"
#include "Components/StaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/PointLight.h"
#include "EngineUtils.h"
#include "FileHelpers.h"
#include "LevelEditor.h"
#include "ContentBrowserModule.h"
#include "IContentBrowserSingleton.h"
#include "SourceCodeNavigation.h"
#include "GameProjectGenerationModule.h"
#include "Misc/App.h"
#include "HAL/PlatformFileManager.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "UObject/SavePackage.h"

FGorkaCommandHandler::FGorkaCommandHandler()
{
}

FGorkaCommandHandler::~FGorkaCommandHandler()
{
}

void FGorkaCommandHandler::ProcessCommand(const TSharedPtr<FJsonObject>& Command)
{
	if (!Command.IsValid())
	{
		return;
	}

	FString CommandId = Command->GetStringField(TEXT("id"));
	FString CommandType = Command->GetStringField(TEXT("command"));
	TSharedPtr<FJsonObject> Params = Command->GetObjectField(TEXT("params"));

	UE_LOG(LogTemp, Log, TEXT("Gorka Copilot: Processing command '%s' (id: %s)"), *CommandType, *CommandId);

	TSharedPtr<FJsonObject> Result;

	// Route command to handler
	if (CommandType == TEXT("create_blueprint"))
	{
		Result = CreateBlueprint(Params);
	}
	else if (CommandType == TEXT("open_blueprint"))
	{
		Result = OpenBlueprint(Params);
	}
	else if (CommandType == TEXT("add_component_to_blueprint"))
	{
		Result = AddComponentToBlueprint(Params);
	}
	else if (CommandType == TEXT("add_variable_to_blueprint"))
	{
		Result = AddVariableToBlueprint(Params);
	}
	else if (CommandType == TEXT("compile_blueprint"))
	{
		Result = CompileBlueprint(Params);
	}
	else if (CommandType == TEXT("create_cpp_class"))
	{
		Result = CreateCppClass(Params);
	}
	else if (CommandType == TEXT("open_source_file"))
	{
		Result = OpenSourceFile(Params);
	}
	else if (CommandType == TEXT("spawn_actor"))
	{
		Result = SpawnActor(Params);
	}
	else if (CommandType == TEXT("delete_actor"))
	{
		Result = DeleteActor(Params);
	}
	else if (CommandType == TEXT("get_level_actors"))
	{
		Result = GetLevelActors(Params);
	}
	else if (CommandType == TEXT("select_actor"))
	{
		Result = SelectActor(Params);
	}
	else if (CommandType == TEXT("get_assets"))
	{
		Result = GetAssets(Params);
	}
	else if (CommandType == TEXT("browse_to_asset"))
	{
		Result = BrowseToAsset(Params);
	}
	else if (CommandType == TEXT("import_asset"))
	{
		Result = ImportAsset(Params);
	}
	else if (CommandType == TEXT("delete_asset"))
	{
		Result = DeleteAsset(Params);
	}
	else if (CommandType == TEXT("play_in_editor"))
	{
		Result = PlayInEditor(Params);
	}
	else if (CommandType == TEXT("stop_play_in_editor"))
	{
		Result = StopPlayInEditor(Params);
	}
	else if (CommandType == TEXT("save_all"))
	{
		Result = SaveAll(Params);
	}
	else if (CommandType == TEXT("compile_project"))
	{
		Result = CompileProject(Params);
	}
	else if (CommandType == TEXT("get_project_info"))
	{
		Result = GetProjectInfo(Params);
	}
	else if (CommandType == TEXT("execute_console_command"))
	{
		Result = ExecuteConsoleCommand(Params);
	}
	else
	{
		Result = MakeErrorResult(FString::Printf(TEXT("Unknown command: %s"), *CommandType));
	}

	// Add command ID to result
	if (Result.IsValid())
	{
		Result->SetStringField(TEXT("command_id"), CommandId);
	}

	// Broadcast result
	OnCommandResult.Broadcast(CommandId, Result);
}

// ===== Blueprint Operations =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::CreateBlueprint(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString BlueprintName = Params->GetStringField(TEXT("name"));
	FString ParentClass = Params->GetStringField(TEXT("parent_class"));
	FString Path = Params->GetStringField(TEXT("path"));

	if (BlueprintName.IsEmpty())
	{
		return MakeErrorResult(TEXT("Blueprint name is required"));
	}

	// Default path
	if (Path.IsEmpty())
	{
		Path = TEXT("/Game/Blueprints");
	}

	// Ensure path starts with /Game
	if (!Path.StartsWith(TEXT("/Game")))
	{
		Path = TEXT("/Game/") + Path;
	}

	// Determine parent class
	UClass* ParentUClass = AActor::StaticClass(); // Default to Actor
	if (!ParentClass.IsEmpty())
	{
		if (ParentClass == TEXT("Pawn"))
		{
			ParentUClass = APawn::StaticClass();
		}
		else if (ParentClass == TEXT("Character"))
		{
			ParentUClass = ACharacter::StaticClass();
		}
		else if (ParentClass == TEXT("PlayerController"))
		{
			ParentUClass = APlayerController::StaticClass();
		}
		else if (ParentClass == TEXT("GameModeBase"))
		{
			ParentUClass = AGameModeBase::StaticClass();
		}
		else if (ParentClass == TEXT("ActorComponent"))
		{
			ParentUClass = UActorComponent::StaticClass();
		}
		else if (ParentClass == TEXT("SceneComponent"))
		{
			ParentUClass = USceneComponent::StaticClass();
		}
		// Add more as needed
	}

	// Create the blueprint
	FString PackagePath = Path / BlueprintName;
	UPackage* Package = CreatePackage(*PackagePath);
	
	if (!Package)
	{
		return MakeErrorResult(TEXT("Failed to create package"));
	}

	UBlueprintFactory* Factory = NewObject<UBlueprintFactory>();
	Factory->ParentClass = ParentUClass;

	UBlueprint* NewBlueprint = Cast<UBlueprint>(Factory->FactoryCreateNew(
		UBlueprint::StaticClass(),
		Package,
		*BlueprintName,
		RF_Public | RF_Standalone,
		nullptr,
		GWarn
	));

	if (!NewBlueprint)
	{
		return MakeErrorResult(TEXT("Failed to create blueprint"));
	}

	// Compile the blueprint
	FKismetEditorUtilities::CompileBlueprint(NewBlueprint);

	// Save the package
	FString PackageFilename = FPackageName::LongPackageNameToFilename(PackagePath, FPackageName::GetAssetPackageExtension());
	FSavePackageArgs SaveArgs;
	SaveArgs.TopLevelFlags = RF_Public | RF_Standalone;
	UPackage::SavePackage(Package, NewBlueprint, *PackageFilename, SaveArgs);

	// Notify asset registry
	FAssetRegistryModule::AssetCreated(NewBlueprint);

	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetStringField(TEXT("asset_path"), PackagePath);
	Data->SetStringField(TEXT("name"), BlueprintName);
	Data->SetStringField(TEXT("parent_class"), ParentUClass->GetName());

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::OpenBlueprint(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));
	if (AssetPath.IsEmpty())
	{
		return MakeErrorResult(TEXT("Asset path is required"));
	}

	// Load the asset
	UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *AssetPath);
	if (!Blueprint)
	{
		return MakeErrorResult(FString::Printf(TEXT("Blueprint not found: %s"), *AssetPath));
	}

	// Open the blueprint editor
	GEditor->GetEditorSubsystem<UAssetEditorSubsystem>()->OpenEditorForAsset(Blueprint);

	return MakeSuccessResult(FString::Printf(TEXT("Opened blueprint: %s"), *AssetPath));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::AddComponentToBlueprint(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));
	FString ComponentType = Params->GetStringField(TEXT("component_type"));
	FString ComponentName = Params->GetStringField(TEXT("component_name"));

	UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *AssetPath);
	if (!Blueprint)
	{
		return MakeErrorResult(FString::Printf(TEXT("Blueprint not found: %s"), *AssetPath));
	}

	// Determine component class
	UClass* ComponentClass = nullptr;
	if (ComponentType == TEXT("StaticMesh"))
	{
		ComponentClass = UStaticMeshComponent::StaticClass();
	}
	else if (ComponentType == TEXT("PointLight"))
	{
		ComponentClass = UPointLightComponent::StaticClass();
	}
	else if (ComponentType == TEXT("Camera"))
	{
		ComponentClass = UCameraComponent::StaticClass();
	}
	else if (ComponentType == TEXT("Audio"))
	{
		ComponentClass = UAudioComponent::StaticClass();
	}
	else if (ComponentType == TEXT("Scene"))
	{
		ComponentClass = USceneComponent::StaticClass();
	}
	else
	{
		return MakeErrorResult(FString::Printf(TEXT("Unknown component type: %s"), *ComponentType));
	}

	// Add component to blueprint
	USCS_Node* NewNode = Blueprint->SimpleConstructionScript->CreateNode(ComponentClass, *ComponentName);
	if (!NewNode)
	{
		return MakeErrorResult(TEXT("Failed to create component node"));
	}

	Blueprint->SimpleConstructionScript->AddNode(NewNode);

	// Compile
	FKismetEditorUtilities::CompileBlueprint(Blueprint);

	// Mark dirty
	Blueprint->MarkPackageDirty();

	return MakeSuccessResult(FString::Printf(TEXT("Added %s component '%s' to blueprint"), *ComponentType, *ComponentName));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::AddVariableToBlueprint(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));
	FString VariableName = Params->GetStringField(TEXT("variable_name"));
	FString VariableType = Params->GetStringField(TEXT("variable_type"));
	bool bIsPublic = Params->GetBoolField(TEXT("is_public"));

	UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *AssetPath);
	if (!Blueprint)
	{
		return MakeErrorResult(FString::Printf(TEXT("Blueprint not found: %s"), *AssetPath));
	}

	// Add variable
	FEdGraphPinType PinType;
	if (VariableType == TEXT("bool") || VariableType == TEXT("Boolean"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Boolean;
	}
	else if (VariableType == TEXT("int") || VariableType == TEXT("Integer"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Int;
	}
	else if (VariableType == TEXT("float") || VariableType == TEXT("Float"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Real;
		PinType.PinSubCategory = UEdGraphSchema_K2::PC_Float;
	}
	else if (VariableType == TEXT("string") || VariableType == TEXT("String"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_String;
	}
	else if (VariableType == TEXT("Vector"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Struct;
		PinType.PinSubCategoryObject = TBaseStructure<FVector>::Get();
	}
	else if (VariableType == TEXT("Rotator"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Struct;
		PinType.PinSubCategoryObject = TBaseStructure<FRotator>::Get();
	}
	else if (VariableType == TEXT("Transform"))
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Struct;
		PinType.PinSubCategoryObject = TBaseStructure<FTransform>::Get();
	}
	else
	{
		PinType.PinCategory = UEdGraphSchema_K2::PC_Object;
	}

	FBlueprintEditorUtils::AddMemberVariable(Blueprint, FName(*VariableName), PinType);

	// Set visibility
	if (bIsPublic)
	{
		FBlueprintEditorUtils::SetBlueprintOnlyEditableFlag(Blueprint, FName(*VariableName), false);
	}

	// Compile
	FKismetEditorUtilities::CompileBlueprint(Blueprint);
	Blueprint->MarkPackageDirty();

	return MakeSuccessResult(FString::Printf(TEXT("Added variable '%s' of type '%s' to blueprint"), *VariableName, *VariableType));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::CompileBlueprint(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));

	UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *AssetPath);
	if (!Blueprint)
	{
		return MakeErrorResult(FString::Printf(TEXT("Blueprint not found: %s"), *AssetPath));
	}

	FKismetEditorUtilities::CompileBlueprint(Blueprint);

	bool bHasErrors = Blueprint->Status == BS_Error;
	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetBoolField(TEXT("success"), !bHasErrors);
	Data->SetStringField(TEXT("status"), bHasErrors ? TEXT("error") : TEXT("success"));

	return MakeResultWithData(!bHasErrors, Data);
}

// ===== C++ Operations =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::CreateCppClass(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString ClassName = Params->GetStringField(TEXT("class_name"));
	FString ParentClass = Params->GetStringField(TEXT("parent_class"));
	FString ModuleName = Params->GetStringField(TEXT("module_name"));

	if (ClassName.IsEmpty())
	{
		return MakeErrorResult(TEXT("Class name is required"));
	}

	// Get project source directory
	FString ProjectDir = FPaths::ProjectDir();
	FString SourceDir = ProjectDir / TEXT("Source");

	// If no module specified, use project name
	if (ModuleName.IsEmpty())
	{
		ModuleName = FApp::GetProjectName();
	}

	FString ModuleSourceDir = SourceDir / ModuleName;

	// Create directories if they don't exist
	FString PublicDir = ModuleSourceDir / TEXT("Public");
	FString PrivateDir = ModuleSourceDir / TEXT("Private");
	IFileManager::Get().MakeDirectory(*PublicDir, true);
	IFileManager::Get().MakeDirectory(*PrivateDir, true);

	// Generate header content
	FString HeaderContent = FString::Printf(TEXT(
		"// Fill out your copyright notice in the Description page of Project Settings.\n\n"
		"#pragma once\n\n"
		"#include \"CoreMinimal.h\"\n"
		"#include \"GameFramework/%s.h\"\n"
		"#include \"%s.generated.h\"\n\n"
		"UCLASS()\n"
		"class %s_API %s : public %s\n"
		"{\n"
		"\tGENERATED_BODY()\n\n"
		"public:\n"
		"\t%s();\n\n"
		"protected:\n"
		"\tvirtual void BeginPlay() override;\n\n"
		"public:\n"
		"\tvirtual void Tick(float DeltaTime) override;\n"
		"};\n"
	), *ParentClass, *ClassName, *ModuleName.ToUpper(), *ClassName, *(TEXT("A") + ParentClass), *ClassName);

	// Generate source content
	FString SourceContent = FString::Printf(TEXT(
		"// Fill out your copyright notice in the Description page of Project Settings.\n\n"
		"#include \"%s.h\"\n\n"
		"%s::%s()\n"
		"{\n"
		"\tPrimaryActorTick.bCanEverTick = true;\n"
		"}\n\n"
		"void %s::BeginPlay()\n"
		"{\n"
		"\tSuper::BeginPlay();\n"
		"}\n\n"
		"void %s::Tick(float DeltaTime)\n"
		"{\n"
		"\tSuper::Tick(DeltaTime);\n"
		"}\n"
	), *ClassName, *ClassName, *ClassName, *ClassName, *ClassName);

	// Write files
	FString HeaderPath = PublicDir / ClassName + TEXT(".h");
	FString SourcePath = PrivateDir / ClassName + TEXT(".cpp");

	if (!FFileHelper::SaveStringToFile(HeaderContent, *HeaderPath))
	{
		return MakeErrorResult(FString::Printf(TEXT("Failed to write header file: %s"), *HeaderPath));
	}

	if (!FFileHelper::SaveStringToFile(SourceContent, *SourcePath))
	{
		return MakeErrorResult(FString::Printf(TEXT("Failed to write source file: %s"), *SourcePath));
	}

	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetStringField(TEXT("header_path"), HeaderPath);
	Data->SetStringField(TEXT("source_path"), SourcePath);
	Data->SetStringField(TEXT("class_name"), ClassName);
	Data->SetStringField(TEXT("message"), TEXT("C++ class created. Hot Reload or restart editor to use."));

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::OpenSourceFile(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString FilePath = Params->GetStringField(TEXT("file_path"));
	int32 LineNumber = Params->GetIntegerField(TEXT("line_number"));

	if (FilePath.IsEmpty())
	{
		return MakeErrorResult(TEXT("File path is required"));
	}

	// Open in IDE
	if (!FSourceCodeNavigation::OpenSourceFile(FilePath, LineNumber))
	{
		return MakeErrorResult(FString::Printf(TEXT("Failed to open source file: %s"), *FilePath));
	}

	return MakeSuccessResult(FString::Printf(TEXT("Opened source file: %s at line %d"), *FilePath, LineNumber));
}

// ===== Level Operations =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::SpawnActor(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString ActorType = Params->GetStringField(TEXT("actor_type"));
	FString ActorName = Params->GetStringField(TEXT("name"));
	
	// Get location
	FVector Location = FVector::ZeroVector;
	if (Params->HasField(TEXT("location")))
	{
		TSharedPtr<FJsonObject> LocObj = Params->GetObjectField(TEXT("location"));
		Location.X = LocObj->GetNumberField(TEXT("x"));
		Location.Y = LocObj->GetNumberField(TEXT("y"));
		Location.Z = LocObj->GetNumberField(TEXT("z"));
	}

	// Get rotation
	FRotator Rotation = FRotator::ZeroRotator;
	if (Params->HasField(TEXT("rotation")))
	{
		TSharedPtr<FJsonObject> RotObj = Params->GetObjectField(TEXT("rotation"));
		Rotation.Pitch = RotObj->GetNumberField(TEXT("pitch"));
		Rotation.Yaw = RotObj->GetNumberField(TEXT("yaw"));
		Rotation.Roll = RotObj->GetNumberField(TEXT("roll"));
	}

	UWorld* World = GEditor->GetEditorWorldContext().World();
	if (!World)
	{
		return MakeErrorResult(TEXT("No active world"));
	}

	AActor* SpawnedActor = nullptr;

	// Determine actor class to spawn
	if (ActorType == TEXT("StaticMeshActor") || ActorType == TEXT("Cube") || ActorType == TEXT("Sphere"))
	{
		SpawnedActor = World->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), Location, Rotation);
		
		// Set default mesh if specified
		if (SpawnedActor && (ActorType == TEXT("Cube") || ActorType == TEXT("Sphere")))
		{
			UStaticMesh* DefaultMesh = nullptr;
			if (ActorType == TEXT("Cube"))
			{
				DefaultMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
			}
			else if (ActorType == TEXT("Sphere"))
			{
				DefaultMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
			}
			
			if (DefaultMesh)
			{
				AStaticMeshActor* MeshActor = Cast<AStaticMeshActor>(SpawnedActor);
				MeshActor->GetStaticMeshComponent()->SetStaticMesh(DefaultMesh);
			}
		}
	}
	else if (ActorType == TEXT("PointLight"))
	{
		SpawnedActor = World->SpawnActor<APointLight>(APointLight::StaticClass(), Location, Rotation);
	}
	else if (ActorType == TEXT("Empty") || ActorType == TEXT("Actor"))
	{
		SpawnedActor = World->SpawnActor<AActor>(AActor::StaticClass(), Location, Rotation);
	}
	else
	{
		// Try to load as blueprint
		FString BlueprintPath = ActorType;
		if (!BlueprintPath.StartsWith(TEXT("/Game")))
		{
			BlueprintPath = TEXT("/Game/") + BlueprintPath;
		}
		
		UBlueprint* Blueprint = LoadObject<UBlueprint>(nullptr, *BlueprintPath);
		if (Blueprint && Blueprint->GeneratedClass)
		{
			SpawnedActor = World->SpawnActor(Blueprint->GeneratedClass, &Location, &Rotation);
		}
	}

	if (!SpawnedActor)
	{
		return MakeErrorResult(FString::Printf(TEXT("Failed to spawn actor of type: %s"), *ActorType));
	}

	// Set name if specified
	if (!ActorName.IsEmpty())
	{
		SpawnedActor->SetActorLabel(*ActorName);
	}

	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetStringField(TEXT("actor_name"), SpawnedActor->GetActorLabel());
	Data->SetStringField(TEXT("actor_class"), SpawnedActor->GetClass()->GetName());

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::DeleteActor(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString ActorName = Params->GetStringField(TEXT("name"));

	UWorld* World = GEditor->GetEditorWorldContext().World();
	if (!World)
	{
		return MakeErrorResult(TEXT("No active world"));
	}

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		if (Actor->GetActorLabel() == ActorName || Actor->GetName() == ActorName)
		{
			Actor->Destroy();
			return MakeSuccessResult(FString::Printf(TEXT("Deleted actor: %s"), *ActorName));
		}
	}

	return MakeErrorResult(FString::Printf(TEXT("Actor not found: %s"), *ActorName));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::GetLevelActors(const TSharedPtr<FJsonObject>& Params)
{
	UWorld* World = GEditor->GetEditorWorldContext().World();
	if (!World)
	{
		return MakeErrorResult(TEXT("No active world"));
	}

	TArray<TSharedPtr<FJsonValue>> ActorsArray;

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		
		TSharedPtr<FJsonObject> ActorObj = MakeShared<FJsonObject>();
		ActorObj->SetStringField(TEXT("name"), Actor->GetActorLabel());
		ActorObj->SetStringField(TEXT("class"), Actor->GetClass()->GetName());
		
		FVector Location = Actor->GetActorLocation();
		TSharedPtr<FJsonObject> LocObj = MakeShared<FJsonObject>();
		LocObj->SetNumberField(TEXT("x"), Location.X);
		LocObj->SetNumberField(TEXT("y"), Location.Y);
		LocObj->SetNumberField(TEXT("z"), Location.Z);
		ActorObj->SetObjectField(TEXT("location"), LocObj);

		ActorsArray.Add(MakeShared<FJsonValueObject>(ActorObj));
	}

	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetArrayField(TEXT("actors"), ActorsArray);

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::SelectActor(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString ActorName = Params->GetStringField(TEXT("name"));

	UWorld* World = GEditor->GetEditorWorldContext().World();
	if (!World)
	{
		return MakeErrorResult(TEXT("No active world"));
	}

	for (TActorIterator<AActor> It(World); It; ++It)
	{
		AActor* Actor = *It;
		if (Actor->GetActorLabel() == ActorName || Actor->GetName() == ActorName)
		{
			GEditor->SelectNone(true, true);
			GEditor->SelectActor(Actor, true, true, true);
			return MakeSuccessResult(FString::Printf(TEXT("Selected actor: %s"), *ActorName));
		}
	}

	return MakeErrorResult(FString::Printf(TEXT("Actor not found: %s"), *ActorName));
}

// ===== Asset Operations =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::GetAssets(const TSharedPtr<FJsonObject>& Params)
{
	FString Path = Params.IsValid() ? Params->GetStringField(TEXT("path")) : TEXT("/Game");
	FString TypeFilter = Params.IsValid() ? Params->GetStringField(TEXT("type")) : TEXT("");

	FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
	IAssetRegistry& AssetRegistry = AssetRegistryModule.Get();

	TArray<FAssetData> AssetDataList;
	AssetRegistry.GetAssetsByPath(FName(*Path), AssetDataList, true);

	TArray<TSharedPtr<FJsonValue>> AssetsArray;
	for (const FAssetData& Asset : AssetDataList)
	{
		// Filter by type if specified
		if (!TypeFilter.IsEmpty() && !Asset.AssetClassPath.GetAssetName().ToString().Contains(TypeFilter))
		{
			continue;
		}

		TSharedPtr<FJsonObject> AssetObj = MakeShared<FJsonObject>();
		AssetObj->SetStringField(TEXT("name"), Asset.AssetName.ToString());
		AssetObj->SetStringField(TEXT("path"), Asset.GetObjectPathString());
		AssetObj->SetStringField(TEXT("class"), Asset.AssetClassPath.GetAssetName().ToString());

		AssetsArray.Add(MakeShared<FJsonValueObject>(AssetObj));
	}

	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetArrayField(TEXT("assets"), AssetsArray);

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::BrowseToAsset(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));

	FContentBrowserModule& ContentBrowserModule = FModuleManager::LoadModuleChecked<FContentBrowserModule>("ContentBrowser");
	TArray<FString> Paths;
	Paths.Add(AssetPath);
	ContentBrowserModule.Get().SyncBrowserToAssets(Paths);

	return MakeSuccessResult(FString::Printf(TEXT("Browsed to: %s"), *AssetPath));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::ImportAsset(const TSharedPtr<FJsonObject>& Params)
{
	// Asset import would require more complex handling
	return MakeErrorResult(TEXT("Import asset not implemented yet"));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::DeleteAsset(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString AssetPath = Params->GetStringField(TEXT("asset_path"));

	// Delete the asset
	TArray<FAssetData> AssetsToDelete;
	FAssetRegistryModule& AssetRegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
	AssetRegistryModule.Get().GetAssetsByPackageName(FName(*AssetPath), AssetsToDelete);

	if (AssetsToDelete.Num() == 0)
	{
		return MakeErrorResult(FString::Printf(TEXT("Asset not found: %s"), *AssetPath));
	}

	// Use ObjectTools to delete
	TArray<UObject*> ObjectsToDelete;
	for (const FAssetData& Asset : AssetsToDelete)
	{
		UObject* LoadedAsset = Asset.GetAsset();
		if (LoadedAsset)
		{
			ObjectsToDelete.Add(LoadedAsset);
		}
	}

	// This would require ObjectTools::DeleteObjects which needs more setup
	return MakeSuccessResult(FString::Printf(TEXT("Would delete: %s (full deletion not implemented for safety)"), *AssetPath));
}

// ===== Editor Operations =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::PlayInEditor(const TSharedPtr<FJsonObject>& Params)
{
	if (GEditor->PlayWorld)
	{
		return MakeErrorResult(TEXT("Already playing in editor"));
	}

	FRequestPlaySessionParams RequestParams;
	GEditor->RequestPlaySession(RequestParams);

	return MakeSuccessResult(TEXT("Started Play in Editor"));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::StopPlayInEditor(const TSharedPtr<FJsonObject>& Params)
{
	if (!GEditor->PlayWorld)
	{
		return MakeErrorResult(TEXT("Not currently playing"));
	}

	GEditor->RequestEndPlayMap();

	return MakeSuccessResult(TEXT("Stopped Play in Editor"));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::SaveAll(const TSharedPtr<FJsonObject>& Params)
{
	FEditorFileUtils::SaveDirtyPackages(
		false,  // bPromptUserToSave
		true,   // bSaveMapPackages
		true,   // bSaveContentPackages
		false,  // bFastSave
		false,  // bNotifyNoPackagesSaved
		false   // bCanBeDeclined
	);

	return MakeSuccessResult(TEXT("Saved all dirty packages"));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::CompileProject(const TSharedPtr<FJsonObject>& Params)
{
	// Trigger hot reload / live coding compile
	IHotReloadModule& HotReloadModule = IHotReloadModule::Get();
	if (HotReloadModule.IsCurrentlyCompiling())
	{
		return MakeErrorResult(TEXT("Already compiling"));
	}

	// Request compile
	HotReloadModule.DoHotReloadFromEditor(EHotReloadFlags::None);

	return MakeSuccessResult(TEXT("Compile requested"));
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::GetProjectInfo(const TSharedPtr<FJsonObject>& Params)
{
	TSharedPtr<FJsonObject> Data = MakeShared<FJsonObject>();
	Data->SetStringField(TEXT("project_name"), FApp::GetProjectName());
	Data->SetStringField(TEXT("engine_version"), FEngineVersion::Current().ToString());
	Data->SetStringField(TEXT("project_dir"), FPaths::ProjectDir());
	Data->SetStringField(TEXT("content_dir"), FPaths::ProjectContentDir());

#if PLATFORM_WINDOWS
	Data->SetStringField(TEXT("platform"), TEXT("Windows"));
#elif PLATFORM_MAC
	Data->SetStringField(TEXT("platform"), TEXT("macOS"));
#else
	Data->SetStringField(TEXT("platform"), TEXT("Linux"));
#endif

	return MakeResultWithData(true, Data);
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::ExecuteConsoleCommand(const TSharedPtr<FJsonObject>& Params)
{
	if (!Params.IsValid())
	{
		return MakeErrorResult(TEXT("Missing parameters"));
	}

	FString Command = Params->GetStringField(TEXT("command"));
	if (Command.IsEmpty())
	{
		return MakeErrorResult(TEXT("Command is required"));
	}

	GEditor->Exec(GEditor->GetEditorWorldContext().World(), *Command);

	return MakeSuccessResult(FString::Printf(TEXT("Executed: %s"), *Command));
}

// ===== Utility =====

TSharedPtr<FJsonObject> FGorkaCommandHandler::MakeSuccessResult(const FString& Message)
{
	TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("type"), TEXT("command_result"));
	Result->SetBoolField(TEXT("success"), true);
	Result->SetStringField(TEXT("message"), Message);
	return Result;
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::MakeErrorResult(const FString& Error)
{
	TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("type"), TEXT("command_result"));
	Result->SetBoolField(TEXT("success"), false);
	Result->SetStringField(TEXT("error"), Error);
	return Result;
}

TSharedPtr<FJsonObject> FGorkaCommandHandler::MakeResultWithData(bool bSuccess, const TSharedPtr<FJsonObject>& Data)
{
	TSharedPtr<FJsonObject> Result = MakeShared<FJsonObject>();
	Result->SetStringField(TEXT("type"), TEXT("command_result"));
	Result->SetBoolField(TEXT("success"), bSuccess);
	Result->SetObjectField(TEXT("data"), Data);
	return Result;
}
