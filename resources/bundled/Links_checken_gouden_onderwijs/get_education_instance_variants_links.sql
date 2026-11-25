select
    educ_institution.id `education institution id`,
    educ_institution.name `education institution name`,
    ei.id `education instance id`,
    ei.name `education instance name`,
    eiv.id `education instance variance id`,
    eiv.website `education instance variance website`
from
    education_instance_variants eiv
    join education_instance_links eil on eil.id = eiv.education_instance_link_id
    join education_instances ei on ei.id = eil.education_instance_id
    join educational_institutions educ_institution on educ_institution.id = eil.educational_institution_id
where
--    educ_institution.id = 144   -- Curio
--    educ_institution.id = 185   -- Hogeschool van Amsterdam
--    educ_institution.id = 186   -- HAN (Hogeschool van Arnhem en Nijmegen)
--    educ_institution.id = 223   -- Maastricht University
--    educ_institution.id = 225   -- Wageningen University & Research
--    educ_institution.id = 5657  -- Albeda
--    educ_institution.id = 5658  -- De Haagse Hogeschool
--    educ_institution.id = 5661  -- Alfa-college
--    educ_institution.id = 5663  -- Grafisch Lyceum Rotterdam
--    educ_institution.id = 5664  -- ROC Mondriaan
--    educ_institution.id = 5669  -- Hogeschool Windesheim
--    educ_institution.id = 5670  -- Hanze
--    educ_institution.id = 5675  -- HZ University of Applied Sciences
--    educ_institution.id = 5676  -- Zuyd Hogeschool
   educ_institution.id = 5681  -- Radboud Universiteit Nijmegen
--    educ_institution.id = 5682  -- Universiteit Utrecht (Bachelor)
--    educ_institution.id = 5809  -- Universiteit Utrecht (Master)
--    educ_institution.id = 5751  -- Yonder
--    educ_institution.id = 5809  -- Universiteit Utrecht Master
--    educ_institution.id = 6115  -- Techniek College Rotterdam
--    educ_institution.id = 6116  -- Aventus
--    educ_institution.id = 5604  -- Thomas More
--    educ_institution.id = 5685  -- University of Curacao Dr Moises Da Costa Gomez
order by educ_institution.name asc;