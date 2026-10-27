    use super::*;
    use chrono::Utc;

    #[test]
    fn test_in_place_import_save_and_export_in_database() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_db_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(54321)));
        let source_photos = temp_dir.join("My Photos");
        let export = temp_dir.join("export");
        fs::create_dir_all(&source_photos).unwrap();
        fs::create_dir_all(&export).unwrap();

        // Create sample photos in user's photo folder
        fs::write(source_photos.join("PHOTO_0001.JPG"), b"fake_photo_1").unwrap();
        fs::write(source_photos.join("PHOTO_0002.JPG"), b"fake_photo_2").unwrap();

        let db_path = temp_dir.join("test_classifier.sqlite");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: "".to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        // 1. Execute in-place import
        let imported = service
            .execute_import(&db, &settings, &source_photos.to_string_lossy(), "SITE-ALPINE")
            .expect("Import should succeed");
        assert_eq!(imported.total_images, 2);
        assert_eq!(imported.site, "SITE-ALPINE");
        assert_eq!(imported.path, source_photos.to_string_lossy().to_string());

        // CRITICAL CHECK: Verify NO subfolders were created in user's photo directory!
        let entries_after_import: Vec<String> = fs::read_dir(&source_photos)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries_after_import.len(), 2);
        assert!(entries_after_import.contains(&"PHOTO_0001.JPG".to_string()));
        assert!(entries_after_import.contains(&"PHOTO_0002.JPG".to_string()));

        // 2. Classify media in database
        let count = service
            .save_classification(
                &mut db,
                &settings,
                &imported.name,
                "PHOTO_0001.JPG",
                &[ClassificationItem {
                    species: "Kea".to_string(),
                    count: 1,
                    comment: "Juvenile on branch".to_string(),
                    sha256: Some("sha_kea".to_string()),
                    species_in_frame: Some(1),
                }],
            )
            .expect("Saving classification should succeed");
        assert_eq!(count, 1);

        // CRITICAL CHECK: Verify NO .txt files were created in user's photo directory!
        assert!(!source_photos.join("PHOTO_0001.txt").exists());
        let entries_after_classify: Vec<String> = fs::read_dir(&source_photos)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(entries_after_classify.len(), 2);

        // 3. Export batch
        let exp_result = service
            .export_batch(&db, &settings, &imported.name)
            .expect("Export should succeed");
        assert_eq!(exp_result.exported_file_count, 1);
        assert_eq!(exp_result.total_records, 1);

        // Verify CSV, XLSX, and JSON exist in export folder
        assert!(Path::new(&exp_result.csv_path).exists());
        assert!(Path::new(&exp_result.xlsx_path).exists());
        assert!(Path::new(&exp_result.json_path).exists());

        // CRITICAL CHECK: Verify image was exported to Images/<Species>/
        let kea_image = export.join("Images").join("Kea").join("PHOTO_0001.JPG");
        assert!(kea_image.exists(), "Images/Kea/PHOTO_0001.JPG must exist");
        // Verify NO .txt files were created anywhere in the export Images folder
        assert!(!export.join("Images").join("Kea").join("PHOTO_0001.txt").exists());
        assert!(!export.join("Images").join("PHOTO_0001.txt").exists());

        // CRITICAL CHECK: Verify user's original photos in source folder are NOT renamed with __
        assert!(source_photos.join("PHOTO_0001.JPG").exists());
        assert!(!source_photos.join("__PHOTO_0001.JPG").exists());

        // 4. Verify batch media response reflects exported status from database
        let media_resp = service
            .get_batch_media(&db, &settings, &imported.name)
            .expect("Get batch media should succeed");
        assert_eq!(media_resp.items.len(), 2);
        let photo1 = media_resp.items.iter().find(|i| i.file_name == "PHOTO_0001.JPG").unwrap();
        assert!(photo1.is_exported);
        assert_eq!(photo1.classifications.len(), 1);
        assert_eq!(photo1.classifications[0].species, "Kea");

        let photo2 = media_resp.items.iter().find(|i| i.file_name == "PHOTO_0002.JPG").unwrap();
        assert!(!photo2.is_exported);
        assert_eq!(photo2.classifications.len(), 0);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_legacy_export_batch_generates_only_csv_xlsx_json() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(12345)));
        let working = temp_dir.join("working");
        let export = temp_dir.join("export");
        let batch_dir = working.join("TEST-BATCH");
        fs::create_dir_all(&batch_dir).unwrap();
        fs::create_dir_all(&export).unwrap();

        // Create mock site file, media file and classification .txt file
        fs::write(batch_dir.join("_site.txt"), "FOREST_SITE\n").unwrap();
        fs::write(batch_dir.join("IMG_0001.JPG"), b"fake_jpeg_content").unwrap();
        fs::write(batch_dir.join("IMG_0001.txt"), "Possum\t2\tAdult in tree\thash123\t1\n").unwrap();

        let db_path = temp_dir.join("test.sqlite");
        let db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: working.to_string_lossy().to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        let result = service.export_batch(&db, &settings, "TEST-BATCH").expect("Export should succeed");
        assert_eq!(result.exported_file_count, 1);
        assert_eq!(result.total_records, 1);

        // Verify CSV exists and contains the expected content
        let csv_path = export.join("TEST-BATCH.csv");
        assert!(csv_path.exists(), "TEST-BATCH.csv must exist");
        let csv_content = fs::read_to_string(&csv_path).unwrap();
        assert!(csv_content.contains("FOREST_SITE"));
        assert!(csv_content.contains("Possum"));
        assert!(csv_content.contains("Adult in tree"));

        // Verify XLSX exists and has content
        let xlsx_path = export.join("TEST-BATCH.xlsx");
        assert!(xlsx_path.exists(), "TEST-BATCH.xlsx must exist");
        assert!(fs::metadata(&xlsx_path).unwrap().len() > 0);

        // Verify JSON exists and is valid
        let json_path = export.join("TEST-BATCH.json");
        assert!(json_path.exists(), "TEST-BATCH.json must exist");
        let json_content = fs::read_to_string(&json_path).unwrap();
        let parsed: Vec<ExportRecord> = serde_json::from_str(&json_content).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].species, "Possum");
        assert_eq!(parsed[0].animal_count, 2);
        assert_eq!(parsed[0].comment, "Adult in tree");

        // Verify Images/Possum/IMG_0001.JPG exists in export
        let possum_image = export.join("Images").join("Possum").join("IMG_0001.JPG");
        assert!(possum_image.exists(), "Images/Possum/IMG_0001.JPG must exist");
        // Verify NO .txt files in Images
        assert!(!export.join("Images").join("Possum").join("IMG_0001.txt").exists());

        let exported_files_list: Vec<String> = fs::read_dir(&export)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        for name in &exported_files_list {
            assert!(
                name.ends_with(".csv") || name.ends_with(".xlsx") || name.ends_with(".json") || name == "Images",
                "Export folder must only contain .csv, .xlsx, .json, or Images folder, but found: {}",
                name
            );
        }

        // Verify media was marked as exported with __ in legacy working directory
        assert!(batch_dir.join("__IMG_0001.JPG").exists());
        assert!(batch_dir.join("__IMG_0001.txt").exists());
        assert!(!batch_dir.join("IMG_0001.JPG").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_working_folder_subfolders_automatically_shown_in_batches() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_wf_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(99999)));
        let working = temp_dir.join("working");
        let export = temp_dir.join("export");
        let cam_a = working.join("Cam_Site_A");
        let cam_b = working.join("Cam_Site_B");
        let cam_b_dcim = cam_b.join("DCIM").join("100RECONX");

        fs::create_dir_all(&cam_a).unwrap();
        fs::create_dir_all(&cam_b_dcim).unwrap();
        fs::create_dir_all(&export).unwrap();

        fs::write(cam_a.join("IMG_0001.JPG"), b"fake_content_1").unwrap();
        fs::write(cam_a.join("IMG_0002.JPG"), b"fake_content_2").unwrap();
        fs::write(cam_b_dcim.join("IMG_0003.JPG"), b"fake_content_3").unwrap();

        let db_path = temp_dir.join("test.sqlite");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: working.to_string_lossy().to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        // When get_batches runs, it should discover both image folders
        let batches = service.get_batches(&db, &settings);
        assert_eq!(batches.len(), 2, "Both camera folders should be discovered as batches");

        let batch_a = batches.iter().find(|b| b.name == "Cam_Site_A").expect("Cam_Site_A must exist");
        assert_eq!(batch_a.total_images, 2);

        let batch_b = batches.iter().find(|b| b.name == "Cam_Site_B").expect("Cam_Site_B must exist");
        assert_eq!(batch_b.total_images, 1);

        // Verify Cam_Site_A is registered in DB and classifications save into SQLite without .txt files
        let media_res = service.get_batch_media(&db, &settings, "Cam_Site_A").expect("Load media should succeed");
        assert_eq!(media_res.items.len(), 2);

        let classification = vec![ClassificationItem {
            species: "Kiwi".to_string(),
            count: 1,
            comment: "Active".to_string(),
            sha256: None,
            species_in_frame: Some(1),
        }];
        service.save_classification(&mut db, &settings, "Cam_Site_A", "IMG_0001.JPG", &classification)
            .expect("Save classification should succeed");

        // Verify NO .txt file was created in cam_a folder
        assert!(!cam_a.join("IMG_0001.txt").exists(), "No .txt files should be created in the camera folder");

        // Verify classification is in SQLite
        let map = db.get_classifications_map_for_batch("Cam_Site_A").unwrap();
        assert_eq!(map.get("IMG_0001.JPG").unwrap().len(), 1);
        assert_eq!(map.get("IMG_0001.JPG").unwrap()[0].species, "Kiwi");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_export_combined_batches_merges_multiple_batches_into_single_files() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_comb_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(77777)));
        let export = temp_dir.join("export");
        let b1_dir = temp_dir.join("Batch1");
        let b2_dir = temp_dir.join("Batch2");
        fs::create_dir_all(&export).unwrap();
        fs::create_dir_all(&b1_dir).unwrap();
        fs::create_dir_all(&b2_dir).unwrap();

        fs::write(b1_dir.join("img1.jpg"), b"fake_img_1").unwrap();
        fs::write(b2_dir.join("img2.jpg"), b"fake_img_2").unwrap();

        let db_path = temp_dir.join("test.sqlite");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: temp_dir.to_string_lossy().to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        db.add_batch(&DbBatch {
            name: "Batch1".to_string(),
            path: b1_dir.to_string_lossy().to_string(),
            site: "Site1".to_string(),
            created_at: Utc::now().to_rfc3339(),
            total_images: 1,
        }).unwrap();

        db.add_batch(&DbBatch {
            name: "Batch2".to_string(),
            path: b2_dir.to_string_lossy().to_string(),
            site: "Site2".to_string(),
            created_at: Utc::now().to_rfc3339(),
            total_images: 1,
        }).unwrap();

        service.save_classification(&mut db, &settings, "Batch1", "img1.jpg", &[
            ClassificationItem {
                species: "Kiwi".to_string(),
                count: 1,
                comment: "At night".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        service.save_classification(&mut db, &settings, "Batch2", "img2.jpg", &[
            ClassificationItem {
                species: "Possum".to_string(),
                count: 2,
                comment: "In tree".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        let res = service.export_combined_batches(&db, &settings, &["Batch1".to_string(), "Batch2".to_string()])
            .expect("Combined export should succeed");

        assert_eq!(res.exported_file_count, 2);
        assert_eq!(res.total_records, 2);

        // Check CSV
        let csv_content = fs::read_to_string(&res.csv_path).unwrap();
        assert!(csv_content.contains("Batch1"));
        assert!(csv_content.contains("Batch2"));
        assert!(csv_content.contains("Kiwi"));
        assert!(csv_content.contains("Possum"));

        // Check JSON
        let json_content = fs::read_to_string(&res.json_path).unwrap();
        let records: Vec<ExportRecord> = serde_json::from_str(&json_content).unwrap();
        assert_eq!(records.len(), 2);

        // Check XLSX
        assert!(Path::new(&res.xlsx_path).exists());

        // Check organized Images folder
        assert!(export.join("Images").join("Kiwi").join("img1.jpg").exists());
        assert!(export.join("Images").join("Possum").join("img2.jpg").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_archived_batch_persists_after_local_folder_deletion_and_exports_data_only() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_archive_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(77777)));
        let working = temp_dir.join("working");
        let export = temp_dir.join("export");
        let custom_export = temp_dir.join("custom_client_export");
        let photo_folder = working.join("Camera_Site_9");
        fs::create_dir_all(&photo_folder).unwrap();
        fs::create_dir_all(&export).unwrap();

        fs::write(photo_folder.join("IMG_0001.JPG"), b"fake_photo_1").unwrap();
        fs::write(photo_folder.join("IMG_0002.JPG"), b"fake_photo_2").unwrap();

        let db_path = temp_dir.join("test.sqlite");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: working.to_string_lossy().to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        // 1. Initial scan: batch is detected and total_images is recorded as 2
        let initial_batches = service.get_batches(&db, &settings);
        assert_eq!(initial_batches.len(), 1);
        assert_eq!(initial_batches[0].total_images, 2);
        assert_eq!(initial_batches[0].status, "unclassified");

        // 2. Classify 1 image
        service.save_classification(&mut db, &settings, "Camera_Site_9", "IMG_0001.JPG", &[
            ClassificationItem {
                species: "Kaka".to_string(),
                count: 3,
                comment: "Feeding in canopy".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        let batches_after_classify = service.get_batches(&db, &settings);
        assert_eq!(batches_after_classify[0].status, "inprogress");
        assert_eq!(batches_after_classify[0].classified_count, 1);

        // 3. User deletes the local raw image folder (to free up laptop disk space)
        fs::remove_dir_all(&photo_folder).unwrap();
        assert!(!photo_folder.exists());

        // 4. CRITICAL CHECK: get_batches() must NOT delete the batch!
        // It must persist with status "archived" and retain total_images = 2, classified_count = 1
        let batches_after_deletion = service.get_batches(&db, &settings);
        assert_eq!(batches_after_deletion.len(), 1, "Batch must persist in Traaace after folder is deleted locally");
        assert_eq!(batches_after_deletion[0].name, "Camera_Site_9");
        assert_eq!(batches_after_deletion[0].status, "archived");
        assert_eq!(batches_after_deletion[0].total_images, 2);
        assert_eq!(batches_after_deletion[0].classified_count, 1);

        // 5. CRITICAL CHECK: Insights / Observations in database must remain 100% intact!
        let observations = db.get_all_observations().unwrap();
        assert_eq!(observations.len(), 1);
        assert_eq!(observations[0].species, "Kaka");
        assert_eq!(observations[0].count, 3);
        assert_eq!(observations[0].comment, "Feeding in canopy");

        // 6. CRITICAL CHECK: Export Data Only (CSV, Excel, JSON) to custom destination must succeed even without photos
        let exp_res = service.export_batch_with_options(
            &db,
            &settings,
            "Camera_Site_9",
            Some("data_only"),
            Some(&custom_export.to_string_lossy()),
            Some(false),
        ).expect("Data-only export must succeed even when raw photos are deleted");

        assert_eq!(exp_res.exported_file_count, 1);
        assert_eq!(exp_res.total_records, 1);
        assert!(exp_res.images_path.is_none());
        assert!(custom_export.join("Camera_Site_9.csv").exists());
        assert!(custom_export.join("Camera_Site_9.xlsx").exists());
        assert!(custom_export.join("Camera_Site_9.json").exists());

        let csv_txt = fs::read_to_string(custom_export.join("Camera_Site_9.csv")).unwrap();
        assert!(csv_txt.contains("Kaka"));
        assert!(csv_txt.contains("Feeding in canopy"));

        // 7. Test relink_batch to a new folder location
        let relocated_folder = temp_dir.join("Relocated_Camera_Site_9");
        fs::create_dir_all(&relocated_folder).unwrap();
        service.relink_batch(&db, "Camera_Site_9", &relocated_folder.to_string_lossy()).unwrap();

        let batch_in_db = db.get_batch("Camera_Site_9").unwrap().unwrap();
        assert_eq!(batch_in_db.path, relocated_folder.to_string_lossy());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_merged_data_export_and_batch_archived_status() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_merge_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(88888)));
        let export = temp_dir.join("export");
        let b1_dir = temp_dir.join("BatchA");
        let b2_dir = temp_dir.join("BatchB");
        fs::create_dir_all(&export).unwrap();
        fs::create_dir_all(&b1_dir).unwrap();
        fs::create_dir_all(&b2_dir).unwrap();

        fs::write(b1_dir.join("photo1.jpg"), b"image_data_1").unwrap();
        fs::write(b2_dir.join("photo2.jpg"), b"image_data_2").unwrap();

        let db_path = temp_dir.join("test.sqlite");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings {
            working_folder: temp_dir.to_string_lossy().to_string(),
            export_folder: export.to_string_lossy().to_string(),
            ..AppSettings::default()
        };

        db.add_batch(&DbBatch {
            name: "BatchA".to_string(),
            path: b1_dir.to_string_lossy().to_string(),
            site: "Valley".to_string(),
            created_at: Utc::now().to_rfc3339(),
            total_images: 1,
        }).unwrap();

        db.add_batch(&DbBatch {
            name: "BatchB".to_string(),
            path: b2_dir.to_string_lossy().to_string(),
            site: "Ridge".to_string(),
            created_at: Utc::now().to_rfc3339(),
            total_images: 1,
        }).unwrap();

        // 1. Initial status: unclassified
        let batches_0 = service.get_batches(&db, &settings);
        assert_eq!(batches_0.iter().find(|b| b.name == "BatchA").unwrap().status, "unclassified");

        // 2. Classify BatchA (1/1 images classified)
        service.save_classification(&mut db, &settings, "BatchA", "photo1.jpg", &[
            ClassificationItem {
                species: "Tui".to_string(),
                count: 2,
                comment: "Nectar feeding".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        // CRITICAL CHECK: Once fully classified, batch status must be "ready" and media_available must be true
        let batches_1 = service.get_batches(&db, &settings);
        let batch_a_1 = batches_1.iter().find(|b| b.name == "BatchA").unwrap();
        assert_eq!(batch_a_1.status, "ready");
        assert!(batch_a_1.media_available);

        // 3. Export BatchA with merge_data: true
        let res_a = service.export_batch_with_options(&db, &settings, "BatchA", None, None, Some(true))
            .expect("Export BatchA should succeed");
        assert!(res_a.merged);
        assert_eq!(res_a.total_records, 1);
        assert_eq!(res_a.batch_records, 1);
        assert!(export.join("traaace_export.csv").exists());
        assert!(export.join("traaace_export.xlsx").exists());
        assert!(export.join("traaace_export.json").exists());
        // Verify image copied to Images/Tui/photo1.jpg
        assert!(export.join("Images").join("Tui").join("photo1.jpg").exists());

        // 4. Classify BatchB (1/1)
        service.save_classification(&mut db, &settings, "BatchB", "photo2.jpg", &[
            ClassificationItem {
                species: "Kereru".to_string(),
                count: 1,
                comment: "Perched".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        let batches_2 = service.get_batches(&db, &settings);
        let batch_b_2 = batches_2.iter().find(|b| b.name == "BatchB").unwrap();
        assert_eq!(batch_b_2.status, "ready");

        // 5. Export BatchB with merge_data: true
        let res_b = service.export_batch_with_options(&db, &settings, "BatchB", None, None, Some(true))
            .expect("Export BatchB should succeed");
        assert!(res_b.merged);
        assert_eq!(res_b.total_records, 2, "Merged dataset must now have 2 records (BatchA + BatchB)");
        assert_eq!(res_b.batch_records, 1);

        // Verify CSV content has both batches merged
        let csv_merged = fs::read_to_string(export.join("traaace_export.csv")).unwrap();
        assert!(csv_merged.contains("BatchA"));
        assert!(csv_merged.contains("BatchB"));
        assert!(csv_merged.contains("Tui"));
        assert!(csv_merged.contains("Kereru"));

        // Verify Images folder contains both species subfolders
        assert!(export.join("Images").join("Tui").join("photo1.jpg").exists());
        assert!(export.join("Images").join("Kereru").join("photo2.jpg").exists());

        // 6. Re-export BatchA with updated comment -> must update existing records without creating duplicates!
        service.save_classification(&mut db, &settings, "BatchA", "photo1.jpg", &[
            ClassificationItem {
                species: "Tui".to_string(),
                count: 2,
                comment: "Updated: Drinking from flax flower".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        let res_a_updated = service.export_batch_with_options(&db, &settings, "BatchA", None, None, Some(true))
            .expect("Re-exporting BatchA should succeed");
        assert_eq!(res_a_updated.total_records, 2, "Must still have exactly 2 records, no duplicates created");
        assert_eq!(res_a_updated.batch_records, 1);

        let csv_updated = fs::read_to_string(export.join("traaace_export.csv")).unwrap();
        assert!(csv_updated.contains("Drinking from flax flower"));
        assert!(!csv_updated.contains("Nectar feeding"));

        // Verify photo1.jpg was not duplicated with BatchA_ prefix in Images/Tui/
        assert!(!export.join("Images").join("Tui").join("BatchA_photo1.jpg").exists());
        assert!(export.join("Images").join("Tui").join("photo1.jpg").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_backup_and_restore_cycle() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_bk_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(99999)));
        fs::create_dir_all(&temp_dir).unwrap();
        let app_dir = temp_dir.join("app");
        let service = ClassifierService::new(&app_dir);
        let mut db = Database::new(service.data_dir.join("trace_classifier.sqlite")).unwrap();

        // 1. Setup initial state: custom keymap + batch + classifications
        let key_item = crate::db::KeymapItem {
            keystrokes: "k".to_string(),
            species: "Kiwi".to_string(),
            builtin: false,
            sort_order: 99,
            hidden: false,
            locked: false,
        };
        let _ = db.save_keymap_item(&key_item);

        let batch = DbBatch {
            name: "SpringCamera01".to_string(),
            path: "/path/to/spring".to_string(),
            site: "ForestNorth".to_string(),
            created_at: Local::now().to_rfc3339(),
            total_images: 10,
        };
        db.add_batch(&batch).unwrap();

        let settings = service.load_settings();
        service.save_classification(&mut db, &settings, "SpringCamera01", "img001.jpg", &[
            ClassificationItem {
                species: "Kiwi".to_string(),
                count: 1,
                comment: "Juvenile foraging".to_string(),
                sha256: None,
                species_in_frame: Some(1),
            }
        ]).unwrap();

        // 2. Create backup
        let backup_zip = temp_dir.join("backup_test.zip");
        let bk_info = service.create_backup(&db, &backup_zip).expect("create_backup should succeed");
        assert!(backup_zip.exists());
        assert_eq!(bk_info.batch_count, 1);
        assert_eq!(bk_info.classification_count, 1);
        assert!(bk_info.species_count >= 1);

        // 3. Mutate active database (delete batch, wipe classifications)
        db.delete_batch("SpringCamera01").unwrap();
        let (b_after, c_after, _) = db.get_stats().unwrap();
        assert_eq!(b_after, 0);
        assert_eq!(c_after, 0);

        // 4. Restore from backup
        let rst_info = service.restore_backup(&mut db, &backup_zip).expect("restore_backup should succeed");
        assert_eq!(rst_info.batch_count, 1);
        assert_eq!(rst_info.classification_count, 1);

        // 5. Verify restored state
        let batches = db.get_all_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].name, "SpringCamera01");
        assert_eq!(batches[0].site, "ForestNorth");

        let classes = db.get_classifications_map_for_batch("SpringCamera01").unwrap();
        assert_eq!(classes.get("img001.jpg").unwrap().len(), 1);
        assert_eq!(classes.get("img001.jpg").unwrap()[0].species, "Kiwi");
        assert_eq!(classes.get("img001.jpg").unwrap()[0].comment, "Juvenile foraging");

        // 6. Test invalid backup error handling
        let fake_file = temp_dir.join("fake_backup.zip");
        fs::write(&fake_file, b"this is not a zip file").unwrap();
        let err = service.restore_backup(&mut db, &fake_file);
        assert!(err.is_err(), "Invalid zip must fail gracefully without panic");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_import_csv_observations() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_csv_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(33333)));
        fs::create_dir_all(&temp_dir).unwrap();
        let app_dir = temp_dir.join("app");
        let service = ClassifierService::new(&app_dir);
        let mut db = Database::new(service.data_dir.join("trace_classifier.sqlite")).unwrap();

        // 1. Create a sample CSV with 2 records
        let csv_path = temp_dir.join("sample_export.csv");
        let csv_content = "site,timestamp,date,time,species,animal_count,sequence,comment,species_in_frame,filename,batch,sha256\n\
                           Valley,2026-10-15T09:30:00Z,2026-10-15,09:30:00,Kea,2,0,Curious bird,1,img001.jpg,BatchValley,hash1\n\
                           Valley,2026-10-15T09:35:00Z,2026-10-15,09:35:00,Tui,1,0,Nectar feeding,1,img002.jpg,BatchValley,hash2\n";
        fs::write(&csv_path, csv_content).unwrap();

        // 2. Import CSV
        let res = service.import_csv_file(&mut db, &csv_path).expect("Import should succeed");
        assert_eq!(res.imported_count, 2);
        assert_eq!(res.batch_count, 1);

        // 3. Verify batch and classifications exist in database
        let batches = db.get_all_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].name, "BatchValley");
        assert_eq!(batches[0].site, "Valley");

        let classes = db.get_classifications_map_for_batch("BatchValley").unwrap();
        assert_eq!(classes.len(), 2);
        assert_eq!(classes.get("img001.jpg").unwrap()[0].species, "Kea");
        assert_eq!(classes.get("img001.jpg").unwrap()[0].count, 2);
        assert_eq!(classes.get("img001.jpg").unwrap()[0].comment, "Curious bird");

        // 4. Verify get_analytics_data picks it up
        let settings = service.load_settings();
        let analytics = service.get_analytics_data(&db, &settings);
        assert_eq!(analytics.observations.len(), 2);

        // 5. Re-import with an updated comment -> should update, not duplicate
        let csv_updated = "site,timestamp,date,time,species,animal_count,sequence,comment,species_in_frame,filename,batch,sha256\n\
                           Valley,2026-10-15T09:30:00Z,2026-10-15,09:30:00,Kea,3,0,Playful Kea pair,1,img001.jpg,BatchValley,hash1\n";
        fs::write(&csv_path, csv_updated).unwrap();
        let res2 = service.import_csv_file(&mut db, &csv_path).expect("Re-import should succeed");
        assert_eq!(res2.imported_count, 1);

        let classes2 = db.get_classifications_map_for_batch("BatchValley").unwrap();
        assert_eq!(classes2.get("img001.jpg").unwrap()[0].count, 3);
        assert_eq!(classes2.get("img001.jpg").unwrap()[0].comment, "Playful Kea pair");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_multi_batch_and_single_batch_import() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_import_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(44444)));
        let footage_dir = temp_dir.join("FootageParent");
        let sub_a = footage_dir.join("SiteA-cam1");
        let sub_b = footage_dir.join("SiteB-cam2");
        let sub_b_dcim = sub_b.join("DCIM").join("100RECONX");
        let sys_vol = footage_dir.join("System Volume Information");

        fs::create_dir_all(&sub_a).unwrap();
        fs::create_dir_all(&sub_b_dcim).unwrap();
        fs::create_dir_all(&sys_vol).unwrap();

        fs::write(sub_a.join("IMG_0001.JPG"), b"fake_1").unwrap();
        fs::write(sub_a.join("IMG_0002.JPG"), b"fake_2").unwrap();
        fs::write(sub_b_dcim.join("IMG_0003.JPG"), b"fake_3").unwrap();

        let db_path = temp_dir.join("test_import.sqlite");
        let db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);
        let settings = AppSettings::default();

        // 1. Preview multi-batch parent folder
        let preview = service.preview_import(&footage_dir.to_string_lossy()).expect("Preview should succeed");
        assert!(preview.is_multi_batch, "Folder containing subfolders must be detected as multi-batch");
        assert_eq!(preview.detected_batches.len(), 2);
        assert_eq!(preview.count, 3);

        let batch_a = preview.detected_batches.iter().find(|b| b.name == "SiteA-cam1").unwrap();
        assert_eq!(batch_a.site, "SiteA");
        assert_eq!(batch_a.count, 2);

        let batch_b = preview.detected_batches.iter().find(|b| b.name == "SiteB-cam2").unwrap();
        assert_eq!(batch_b.site, "SiteB");
        assert_eq!(batch_b.count, 1);

        // 2. Execute multi-batch import
        let res = service.execute_import(&db, &settings, &footage_dir.to_string_lossy(), "").expect("Import should succeed");
        assert_eq!(res.total_batches, 2);
        assert_eq!(res.total_images, 3);

        let all_db = db.get_all_batches().unwrap();
        assert_eq!(all_db.len(), 2);
        assert!(all_db.iter().any(|b| b.name == "SiteA-cam1" && b.site == "SiteA"));
        assert!(all_db.iter().any(|b| b.name == "SiteB-cam2" && b.site == "SiteB"));

        // 3. Preview single batch folder directly
        let single_preview = service.preview_import(&sub_a.to_string_lossy()).expect("Single preview should succeed");
        assert!(!single_preview.is_multi_batch);
        assert_eq!(single_preview.count, 2);
        assert_eq!(single_preview.suggested_site, "SiteA");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_import_csv_with_varied_timestamp_formats() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_csv_ts_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(55555)));
        fs::create_dir_all(&temp_dir).unwrap();
        let app_dir = temp_dir.join("app");
        let service = ClassifierService::new(&app_dir);
        let mut db = Database::new(service.data_dir.join("trace_classifier.sqlite")).unwrap();

        // CSV matching the user's exact format with varied space-separated timestamps and folder column
        let csv_content = "species,site,folder,timestamp,filename,file_path,animal_count,comments\n\
                           banded_rail,ACC,site_ACC,2026-10-06 17:59:37,banded_rail__0067A52A.JPG,/path/to/img1.jpg,1,Sample test\n\
                           banded_rail,ACC,site_ACC,2025-11-16 02:50:10,banded_rail__0331C7C7.JPG,/path/to/img2.jpg,1,Sample test\n";

        let csv_file = temp_dir.join("test_user_format.csv");
        fs::write(&csv_file, csv_content).unwrap();

        let res = service.import_csv_file(&mut db, &csv_file).expect("CSV import should succeed");
        assert_eq!(res.imported_count, 2);
        assert_eq!(res.batch_count, 1);

        // Fetch observations and verify dates are preserved as 2026-10-06 and 2025-11-16, NOT today!
        let obs = db.get_all_observations().unwrap();
        assert_eq!(obs.len(), 2);

        let obs_1 = obs.iter().find(|o| o.filename == "banded_rail__0067A52A.JPG").unwrap();
        assert_eq!(obs_1.date_str, "2026-10-06");
        assert_eq!(obs_1.year, 2026);
        assert_eq!(obs_1.month, 10);
        assert_eq!(obs_1.day, 6);
        assert_eq!(obs_1.hour, 17);
        assert_eq!(obs_1.batch, "site_ACC");

        let obs_2 = obs.iter().find(|o| o.filename == "banded_rail__0331C7C7.JPG").unwrap();
        assert_eq!(obs_2.date_str, "2025-11-16");
        assert_eq!(obs_2.year, 2025);
        assert_eq!(obs_2.month, 11);
        assert_eq!(obs_2.day, 16);
        assert_eq!(obs_2.hour, 2);
        assert_eq!(obs_2.batch, "site_ACC");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_import_manifest_csv_with_species_and_exif_inferred_from_disk() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_manifest_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(88888)));
        fs::create_dir_all(&temp_dir).unwrap();
        let app_dir = temp_dir.join("app");
        let service = ClassifierService::new(&app_dir);
        let mut db = Database::new(service.data_dir.join("trace_classifier.sqlite")).unwrap();

        // 1. Setup site folder and an image file with embedded EXIF date
        let site_dir = temp_dir.join("site_ACC");
        fs::create_dir_all(&site_dir).unwrap();

        let image_filename = "banded_rail__0A5BBB60-9A44-4E09-A48B-2DC642BA11DC.JPG";
        let image_path = site_dir.join(image_filename);
        let mut dummy_jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1]; // JPEG APP1 marker
        dummy_jpeg.extend_from_slice(b"Exif\0\0SomeExifData 2023:05:12 12:27:37 EndOfExif");
        dummy_jpeg.resize(1024, 0);
        fs::write(&image_path, dummy_jpeg).unwrap();

        // 2. CSV formatted exactly like user's traaace_manifest.csv (NO species column, NO date column, un-prefixed filename)
        let csv_content = format!(
            "site,folder,filename,file_path,comments\n\
             ACC,site_ACC,0A5BBB60-9A44-4E09-A48B-2DC642BA11DC.JPG,{}/site_ACC/0A5BBB60-9A44-4E09-A48B-2DC642BA11DC.JPG,Sample test image\n",
            temp_dir.display()
        );

        let manifest_path = temp_dir.join("traaace_manifest.csv");
        fs::write(&manifest_path, csv_content).unwrap();

        // 3. Import CSV
        let res = service.import_csv_file(&mut db, &manifest_path).expect("Manifest import should succeed");
        assert_eq!(res.imported_count, 1);
        assert_eq!(res.batch_count, 1);

        // 4. Verify observation details
        let obs = db.get_all_observations().unwrap();
        assert_eq!(obs.len(), 1);
        let o = &obs[0];
        assert_eq!(o.species, "Banded Rail");
        assert_eq!(o.filename, image_filename);
        assert_eq!(o.date_str, "2023-05-12");
        assert_eq!(o.year, 2023);
        assert_eq!(o.month, 5);
        assert_eq!(o.day, 12);
        assert_eq!(o.hour, 12);
        assert_eq!(o.batch, "site_ACC");

        // 5. Verify batch path
        let batches = db.get_all_batches().unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].name, "site_ACC");
        assert_eq!(batches[0].path, site_dir.to_string_lossy().to_string());

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_uploaded_csv_timestamps() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_user_csv_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(11223)));
        fs::create_dir_all(&temp_dir).unwrap();
        let app_dir = temp_dir.join("app");
        let service = ClassifierService::new(&app_dir);
        let mut db = Database::new(service.data_dir.join("trace_classifier.sqlite")).unwrap();

        let today_str = Local::now().format("%Y-%m-%d").to_string();

        // 1. Test user's exact uploaded CSV with separate Date and Time columns
        let user_csv_content = "Folder,File,Site Name,Date,Time,Species,Animal Count,Comment\n\
cam_unit_01,bellbird_0005.jpg,ACC,2024-09-17,21:34:09,Bellbird,1,Lurking near vegetation border\n\
cam_unit_01,swan_0026.jpg,ACC,2025-01-27,17:12:11,Black Swan,1,Quick fly-by capture\n\
cam_unit_01,blackbird_0023.jpg,ACC,2026-07-22,23:39:12,Blackbird,1,Lurking near vegetation border\n";
        let csv_path = temp_dir.join("user_test.csv");
        fs::write(&csv_path, user_csv_content).unwrap();

        let res = service.import_csv_file(&mut db, &csv_path).expect("Import should succeed");
        assert_eq!(res.imported_count, 3);

        let obs = db.get_all_observations().unwrap();
        assert_eq!(obs.len(), 3);

        let bellbird = obs.iter().find(|o| o.filename == "bellbird_0005.jpg").unwrap();
        assert_eq!(bellbird.date_str, "2024-09-17");
        assert_eq!(bellbird.year, 2024);
        assert_eq!(bellbird.month, 9);
        assert_eq!(bellbird.day, 17);
        assert_eq!(bellbird.hour, 21);
        assert_ne!(bellbird.date_str, today_str);

        let swan = obs.iter().find(|o| o.filename == "swan_0026.jpg").unwrap();
        assert_eq!(swan.date_str, "2025-01-27");
        assert_eq!(swan.year, 2025);
        assert_eq!(swan.month, 1);
        assert_eq!(swan.day, 27);
        assert_eq!(swan.hour, 17);
        assert_ne!(swan.date_str, today_str);

        // 2. Test Windows Excel format with DD/MM/YYYY and 12-hour AM/PM time
        let win_excel_csv = "Folder,File,Site Name,Date,Time,Species,Animal Count,Comment\n\
cam_unit_02,robin_0008.jpg,AHO,10/10/2024,8:18:02 AM,Robin,1,Sunlight flare at top of lens\n\
cam_unit_02,harrier_0025.jpg,AHO,20/05/2025,4:09:03 PM,Harrier Hawk,1,Quick fly-by capture\n";
        let win_csv_path = temp_dir.join("windows_excel.csv");
        fs::write(&win_csv_path, win_excel_csv).unwrap();

        let res_win = service.import_csv_file(&mut db, &win_csv_path).expect("Import should succeed");
        assert_eq!(res_win.imported_count, 2);

        let obs_all = db.get_all_observations().unwrap();
        let robin = obs_all.iter().find(|o| o.filename == "robin_0008.jpg").unwrap();
        assert_eq!(robin.date_str, "2024-10-10");
        assert_eq!(robin.year, 2024);
        assert_eq!(robin.month, 10);
        assert_eq!(robin.day, 10);
        assert_eq!(robin.hour, 8);
        assert_ne!(robin.date_str, today_str);

        let harrier = obs_all.iter().find(|o| o.filename == "harrier_0025.jpg").unwrap();
        assert_eq!(harrier.date_str, "2025-05-20");
        assert_eq!(harrier.year, 2025);
        assert_eq!(harrier.month, 5);
        assert_eq!(harrier.day, 20);
        assert_eq!(harrier.hour, 16);
        assert_ne!(harrier.date_str, today_str);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_csv_import_does_not_pollute_keymap_or_preset_comments() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_test_isolate_{}", Local::now().timestamp_nanos_opt().unwrap_or(998877)));
        fs::create_dir_all(&temp_dir).unwrap();
        let db_path = temp_dir.join("test.db");
        let mut db = Database::new(&db_path).unwrap();
        let service = ClassifierService::new(&temp_dir);

        let initial_keymaps = db.get_all_keymap().unwrap();
        let initial_comments = db.get_comments().unwrap();

        let csv_content = "Folder,File,Site Name,Date,Time,Species,Animal Count,Comment\n\
cam_01,pic1.jpg,SiteA,2024-09-17,21:34:09,Unseen Alien Species,1,Completely unique comment not in presets\n\
cam_01,pic2.jpg,SiteA,2024-09-17,21:35:10,Mysterious Creature,2,Another unique comment\n";
        let csv_path = temp_dir.join("unique_records.csv");
        fs::write(&csv_path, csv_content).unwrap();

        let res = service.import_csv_file(&mut db, &csv_path).expect("Import must succeed");
        assert_eq!(res.imported_count, 2);

        // Keymaps and preset comments must remain completely unchanged
        let after_keymaps = db.get_all_keymap().unwrap();
        assert_eq!(after_keymaps.len(), initial_keymaps.len(), "Keymaps table must NOT be modified by CSV import");
        for k in &after_keymaps {
            assert_ne!(k.species, "Unseen Alien Species");
            assert_ne!(k.species, "Mysterious Creature");
        }

        let after_comments = db.get_comments().unwrap();
        assert_eq!(after_comments.len(), initial_comments.len(), "Preset comments list must NOT be modified by CSV import");
        assert!(!after_comments.contains(&"Completely unique comment not in presets".to_string()));
        assert!(!after_comments.contains(&"Another unique comment".to_string()));

        // But observations are preserved and queryable for insights
        let obs = db.get_all_observations().unwrap();
        assert_eq!(obs.len(), 2);
        assert!(obs.iter().any(|o| o.species == "Unseen Alien Species" && o.comment == "Completely unique comment not in presets"));
        assert!(obs.iter().any(|o| o.species == "Mysterious Creature" && o.comment == "Another unique comment"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_auto_advance_delay_loads_from_old_settings_and_is_capped() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_delay_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(1234)));
        fs::create_dir_all(&temp_dir).unwrap();
        let service = ClassifierService::new(&temp_dir);

        // A settings file written before autoAdvanceDelay existed must still load.
        fs::create_dir_all(&service.data_dir).unwrap();
        fs::write(
            &service.settings_path,
            r#"{"workingFolder":"","exportFolder":"","keyboardDelay":400,"autoAdvance":true,"theme":"dark","contrast":"standard","uiScale":1.0}"#,
        )
        .unwrap();
        let loaded = service.load_settings();
        assert_eq!(loaded.theme, "dark");
        assert!(loaded.auto_advance);
        assert_eq!(loaded.auto_advance_delay, 0);

        let patch = |ms| UpdateSettings { auto_advance_delay: Some(ms), ..UpdateSettings::default() };
        assert_eq!(service.update_settings(patch(1200)).unwrap().auto_advance_delay, 1200);
        assert_eq!(service.load_settings().auto_advance_delay, 1200);
        assert_eq!(service.update_settings(patch(999_999)).unwrap().auto_advance_delay, 3000);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_default_nz_species_list() {
        let temp_dir = std::env::temp_dir().join(format!("traaace_species_test_{}", Local::now().timestamp_nanos_opt().unwrap_or(4321)));
        fs::create_dir_all(&temp_dir).unwrap();
        let db = Database::new(&temp_dir.join("test.sqlite")).unwrap();

        // A fresh database is seeded with the defaults; resetting restores them.
        let keymaps = db.reset_default_keymaps().unwrap();
        assert_eq!(keymaps.len(), 40);
        assert_eq!(db.get_all_keymap().unwrap().len(), 40);

        // Display order follows the supplied list (alphabetical, with the non-species entries last).
        let species: Vec<&str> = keymaps.iter().map(|k| k.species.as_str()).collect();
        assert_eq!(species.first(), Some(&"Band-rail"));
        assert_eq!(species.last(), Some(&"Farm animal"));
        assert_eq!(&species[species.len() - 3..], ["Human", "Vehicle", "Farm animal"]);
        assert!(keymaps.windows(2).all(|w| w[0].sort_order < w[1].sort_order));
        assert!(keymaps.iter().all(|k| k.builtin && !k.hidden && !k.locked));

        // Names keep their macrons and alternative names exactly as supplied.
        for name in ["Kererū / NZ Pigeon", "Pāteke / Brown Teal", "Tīeke / Saddleback", "Tūī", "Pūkeko", "Takahē", "Morepork / Ruru"] {
            assert!(species.contains(&name), "missing {name}");
        }

        let keys: Vec<&str> = keymaps.iter().map(|k| k.keystrokes.as_str()).collect();
        let unique: std::collections::HashSet<&&str> = keys.iter().collect();
        assert_eq!(unique.len(), keys.len(), "keystrokes must be unique");

        // No digits (those are slot keys) and nothing that steals the Grid / Comment shortcuts.
        assert!(keys.iter().all(|k| k.chars().all(|c| c.is_ascii_uppercase())));
        assert!(!keys.contains(&"G") && !keys.contains(&"C"));
        assert!(keys.iter().all(|k| !k.starts_with('G')));

        // Only P, M, R and W are also the start of a longer code, so only those wait for a second key.
        let mut prefixes: Vec<&str> = keys
            .iter()
            .copied()
            .filter(|k| keys.iter().any(|o| o.len() > k.len() && o.starts_with(k)))
            .collect();
        prefixes.sort();
        assert_eq!(prefixes, ["M", "P", "R", "W"]);

        let _ = fs::remove_dir_all(&temp_dir);
    }

